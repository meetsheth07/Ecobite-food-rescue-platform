const SystemSettings = require("../models/SystemSettings");

async function rejectWhenPaused(req, res, next) {
  try {
    const settings = await SystemSettings.findOne({ key: "global" }).lean();
    if (settings?.emergency_pause) {
      return res.status(503).json({
        message: "EcoBite is temporarily paused. New listings and claims are disabled.",
      });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { rejectWhenPaused };
