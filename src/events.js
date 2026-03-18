const EventEmitter = require('events');

// Central event bus for crawl progress
// Events emitted:
//   crawl:status  { domain, status, message }
//   crawl:metric  { domain, category, score, metrics }
//   crawl:complete { domain, scores }
//   crawl:error   { domain, error }
//   crawl:blocked { domain, reason }

const bus = new EventEmitter();
bus.setMaxListeners(100); // allow many SSE clients

module.exports = bus;
