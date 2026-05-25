const { ALLOWED_ORIGINS } = require("./config");

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (!ALLOWED_ORIGINS.length) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

function buildCorsOptions() {
  return {
    origin: function(origin, callback) {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed by CORS: " + origin));
    },
  };
}

module.exports = {
  isAllowedOrigin: isAllowedOrigin,
  buildCorsOptions: buildCorsOptions,
};
