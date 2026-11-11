const { call } = require('./cloud')

module.exports = {
  subscribe(tripId, templateId) {
    return call('notify.subscribe', { tripId: tripId, templateId: templateId })
  }
}
