const {Builder, By} = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const config = require('./config.json');
const logger = require('log4js').getLogger('tokens-update');
const mysql = require('mysql');
const connection = mysql.createConnection(config.mysql);
const Beanstalk = require('./beanstalk-client');
logger.level = 'info';

const $ = (driver, selector) => {
    return driver.findElement(By.css(selector));
};

const sleep = (sleep) => {
    return new Promise((resolve) => {
        setTimeout(() => resolve(), sleep);
    });
};

(async() => {
    let beanstalk = null;
    try {
        beanstalk = await new Beanstalk(config.beanstalkd.host, config.beanstalkd.port);
        logger.info(`connected to beanstalk to "${beanstalk.defaultTube}" queue`);
    } catch (e) {
        logger.error(e.message);
        process.exit(-1);
    }

    // beanstalk.publishMessage({account: 'jhque.wam'});
    while (true) {
        try {
            const {id, payload} = await new Promise(async (resolve, reject) => {
                beanstalk.getMessage(beanstalk.defaultTube, (err, id, payload) => {
                    if (err) {
                        return reject(err);
                    }
                    const {account} = payload;

                    if (typeof account === 'undefined') {
                        return reject(new Error(`payload is broken ${JSON.stringify(payload)}`));
                    }
                    connection.query(`SELECT *
                                      FROM accounts
                                      WHERE account = "${account}" LIMIT 1`, async (err, results) => {
                        if (err) {
                            return reject(err);
                        }
                        for (const {account, proxy, wax_user_name: login, wax_password: password} of results) {
                            const chromeOptions = new chrome.Options();
                            chromeOptions.addArguments('start-maximized');

                            /** If custom proxy is set */
                            chromeOptions.addArguments('--proxy-server=' + proxy);

                            logger.warn(account);
                            logger.info(`connecting to selenium...`);
                            const driver = await new Builder()
                                .usingServer(config.selenium.url)
                                .setChromeOptions(chromeOptions)
                                .withCapabilities(config.selenium.capabilities)
                                .forBrowser('chrome')
                                .build();

                            try {
                                logger.info('navigate to all-access.wax.io');
                                await driver.get('https://all-access.wax.io');
                                await sleep(2000);

                                /** Login to All-Access WAX.io */
                                logger.info('log in to all-access.wax.io');
                                await $(driver, 'input[name="userName"]').sendKeys(login);
                                await $(driver, 'input[name="password"]').sendKeys(password);
                                await $(driver, 'button.button-primary').click();
                                await sleep(3000);

                                /** Obtain session token cookie and update it to database */
                                const {value: token} = await driver.manage().getCookie('session_token');
                                logger.info(`session token "${token}"`);

                                /** Update atomic hub session token */
                                connection.query(`UPDATE accounts
                                                  SET wax_session_token = "${token}"
                                                  WHERE account = "${account}" LIMIT 1`, async (err) => {
                                    if (err) {
                                        return reject(err);
                                    }
                                    resolve({id, payload});
                                });
                            } catch (e) {
                                reject(e);
                            } finally {
                                await driver.quit();
                            }
                        }
                    });
                });
            });
            logger.info(`job completed ${JSON.stringify({id, payload})}`);
        } catch (e) {
            logger.error(e.message);
        }
    }
})();
