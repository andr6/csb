const { enqueueWebhook } = require("./webhookQueue");

async function notifyWebhook(event) {
  enqueueWebhook(event);
}

module.exports = { notifyWebhook: notifyWebhook };
