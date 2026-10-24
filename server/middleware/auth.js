const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function authMiddleware(req, res, next) {
  const token = req.cookies?.ecobiteToken || req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return res.status(401).json({ message: "Authentication is required." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ message: "Session is no longer valid." });
    if (user.role !== payload.role) {
      return res.status(401).json({ message: "Your session is no longer valid. Please sign in again." });
    }
    req.user = user;
    return next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Your session has expired. Please sign in again." });
    }
    return next(error);
  }
}

function roleMiddleware(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "You do not have access to this resource." });
    }
    return next();
  };
}

module.exports = { authMiddleware, roleMiddleware };
