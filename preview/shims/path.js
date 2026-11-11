module.exports = { join: (...a) => a.join('/'), dirname: (p) => p.split('/').slice(0, -1).join('/') };
