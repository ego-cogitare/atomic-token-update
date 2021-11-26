const logger = require('log4js').getLogger('[beanstalk-client]');
const Beanstalkd = require('beanstalkd').default;

class BeanstalkClient
{
    /**
     * @param host
     * @param port
     * @returns {Promise<unknown>}
     */
    constructor(host = '', port = 11300, tube = 'atomic-token-update') {
        const beanstalkd = new Beanstalkd(host, port);
        this.client = null;
        this.defaultTube = tube;
        logger.level = process.env.NODE_LOG_LEVEL || 'info';

        return new Promise((resolve, error) => {
            beanstalkd
                .connect()
                .then(client => {
                    this.client = client;
                    resolve(this);
                })
                .catch(err => error(err));
        });
    }

    /**
     * @returns {Beanstalkd}
     */
    getClient() {
        return this.client;
    }

    /**
     * Send message to beanstalk queue
     * @param tube
     * @param message {{*}}
     * @param callback
     */
    publishMessage(message = {}, tube = this.defaultTube, callback) {
        this.getClient().use(tube).then(() => {
            this.getClient().put(0, 0, 1, JSON.stringify(message))
                .then((res) => {
                    logger.info(`Message published to ${tube} channel, res: ${res}`);

                    /** Call callback function on message sent */
                    if (typeof callback === 'function') {
                        callback(res, null);
                    }
                })
                .catch((err) => {
                    logger.error(`Error message publishing to ${tube} channel, err: ${err.message}`);

                    /** Call callback function on message sent */
                    if (typeof callback === 'function') {
                        callback(null, err);
                    }
                });
        });
    }

    /**
     * Get message from beanstalk queue
     * @param tube
     * @param callback
     */
    getMessage(tube = this.defaultTube, callback) {
        this.getClient().watch(tube).then(() => {
            this.getClient().reserve()
                .then(async ([jobId, jobData]) => {
                    logger.info(`Message #${jobId} read from ${tube} channel, res: ${jobData.toString()}`);

                    /** Remove message from queue */
                    await this.getClient().delete(jobId);

                    /** Call callback function on message sent */
                    if (typeof callback === 'function') {
                        callback(null, jobId, JSON.parse(jobData.toString()));
                    }
                })
                .catch((err) => {
                    logger.error(`message parse from ${tube} channel fails, message: ${err.message}`);

                    /** Call callback function on message sent */
                    if (typeof callback === 'function') {
                        callback(err);
                    }
                });
        });
    }
}

module.exports = BeanstalkClient;
