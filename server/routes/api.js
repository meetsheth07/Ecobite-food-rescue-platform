const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const PDFDocument = require("pdfkit");
const { z } = require("zod");
const User = require("../models/User");
const FoodListing = require("../models/FoodListing");
const Match = require("../models/Match");
const Dispute = require("../models/Dispute");
const SystemSettings = require("../models/SystemSettings");
const { authMiddleware, roleMiddleware } = require("../middleware/auth");
const { rejectWhenPaused } = require("../middleware/systemPause");
const { haversineKm } = require("../utils/geo");
const {
  registerSchema,
  loginSchema,
  listingSchema,
} = require("../utils/validation");

const router = express.Router();

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        message: "Please check the submitted information.",
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    req.validatedBody = result.data;
    return next();
  };
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    organization: user.organization,
    phone: user.phone,
    location: user.location,
    serviceRadiusKm: user.serviceRadiusKm,
    capacityMeals: user.capacityMeals,
    reservedMeals: user.reservedMeals,
    available: user.available,
    verified: user.verified,
    verificationStatus: user.verificationStatus,
  };
}

function setAuthCookie(res, user) {
  const token = jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
  res.cookie("ecobiteToken", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

async function notifyAvailableVolunteers(listing, donor, receiver) {
  const volunteers = await User.find({
    role: "volunteer",
    available: true,
    phone: { $exists: true, $ne: "" },
    location: {
      $near: {
        $geometry: listing.location,
        $maxDistance: 10000,
      },
    },
  }).select("phone");
  const message = `EcoBite pickup: ${listing.title} from ${donor.organization || donor.name} to ${receiver.organization || receiver.name}. Collect before ${new Date(listing.expiresAt).toLocaleTimeString()}.`;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!sid || !token || !from) {
    console.info(
      JSON.stringify({
        event: "sms.simulated",
        recipients: volunteers.length,
        listing: listing._id.toString(),
        message,
      }),
    );
    return;
  }

  const client = require("twilio")(sid, token);
  const results = await Promise.allSettled(
    volunteers.map((volunteer) =>
      client.messages.create({ body: message, from, to: volunteer.phone }),
    ),
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    console.error(
      `Twilio failed to deliver ${failures.length} of ${volunteers.length} volunteer notifications.`,
      failures.map((failure) => failure.reason.message),
    );
  }
}

router.post("/auth/register", validateBody(registerSchema), async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      role,
      organization,
      phone,
      location,
      serviceRadiusKm,
      capacityMeals,
    } = req.validatedBody;
    if (await User.exists({ email })) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }
    const user = await User.create({
      name,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role,
      organization,
      phone,
      location: { type: "Point", coordinates: [location.lng, location.lat] },
      serviceRadiusKm,
      capacityMeals,
      verified: role !== "receiver",
      verificationStatus: role === "receiver" ? "pending" : "verified",
    });
    setAuthCookie(res, user);
    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.post("/auth/login", validateBody(loginSchema), async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.validatedBody.email }).select("+passwordHash");
    if (!user || !(await bcrypt.compare(req.validatedBody.password, user.passwordHash))) {
      return res.status(401).json({ message: "Email or password is incorrect." });
    }
    setAuthCookie(res, user);
    return res.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.post("/auth/logout", (_req, res) => {
  res.clearCookie("ecobiteToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  return res.status(204).end();
});

router.get("/auth/me", authMiddleware, (req, res) =>
  res.json({ user: publicUser(req.user) }),
);

router.get("/system", async (_req, res, next) => {
  try {
    const settings = await SystemSettings.findOne({ key: "global" }).lean();
    return res.json({ emergencyPause: settings?.emergency_pause ?? false });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/listings",
  authMiddleware,
  roleMiddleware("donor"),
  rejectWhenPaused,
  validateBody(listingSchema),
  async (req, res, next) => {
    try {
      const body = req.validatedBody;
      const coordinates = [body.location.lng, body.location.lat];
      const expectedMeals =
        body.unit === "meals" ? body.quantity : Math.ceil(body.quantity * 2);
      const receivers = await User.find({
        role: "receiver",
        verified: true,
        available: true,
        capacityMeals: { $gte: expectedMeals },
        $expr: {
          $gte: [
            { $subtract: ["$capacityMeals", "$reservedMeals"] },
            expectedMeals,
          ],
        },
        location: {
          $near: {
            $geometry: { type: "Point", coordinates },
            $maxDistance: 10000,
          },
        },
      })
        .select("_id name organization location capacityMeals")
        .limit(50);
      const listing = await FoodListing.create({
        donor: req.user._id,
        ...body,
        location: { type: "Point", coordinates },
        matchedReceivers: receivers.map((receiver) => receiver._id),
        matchedReceiverCount: receivers.length,
        availableQuantity: body.quantity,
      });
      const matches = receivers.map((receiver) => ({
        ...publicUser(receiver),
        distanceKm: Number(
          haversineKm(coordinates, receiver.location.coordinates).toFixed(1),
        ),
      }));
      return res.status(201).json({ listing, nearbyReceivers: matches });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/listings/mine",
  authMiddleware,
  roleMiddleware("donor"),
  async (req, res, next) => {
    try {
      const listings = await FoodListing.find({ donor: req.user._id })
        .sort({ createdAt: -1 })
        .populate("claimedBy", "name organization");
      return res.json({ listings });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/listings/nearby",
  authMiddleware,
  roleMiddleware("receiver"),
  async (req, res, next) => {
    try {
      if (!req.user.verified) {
        return res.status(403).json({ message: "Your organization must be verified before claiming food." });
      }
      const listings = await FoodListing.find({
        status: "available",
        expiresAt: { $gt: new Date() },
        matchedReceivers: req.user._id,
        location: {
          $near: {
            $geometry: req.user.location,
            $maxDistance: 10000,
          },
        },
      })
        .populate("donor", "name organization location")
        .limit(100)
        .lean();
      const ranked = listings.map((listing) => ({
        ...listing,
        mealEstimate:
          listing.unit === "meals"
            ? listing.quantity
            : Math.ceil(listing.quantity * 2),
        distanceKm: Number(
          haversineKm(req.user.location.coordinates, listing.location.coordinates).toFixed(1),
        ),
      }));
      return res.json({ listings: ranked });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/matches/claim",
  authMiddleware,
  roleMiddleware("receiver"),
  rejectWhenPaused,
  validateBody(z.object({ listingId: z.string().regex(/^[a-f\d]{24}$/i) })),
  async (req, res, next) => {
    const session = await FoodListing.startSession();
    try {
      if (!req.user.verified) {
        await session.endSession();
        return res.status(403).json({ message: "Your organization must be verified before claiming food." });
      }
      let match;
      let listingSnapshot;
      await session.withTransaction(async () => {
        const listing = await FoodListing.findOne({
          _id: req.validatedBody.listingId,
          status: "available",
          expiresAt: { $gt: new Date() },
          matchedReceivers: req.user._id,
          availableQuantity: { $gt: 0 },
        }).session(session);
        if (!listing) {
          const error = new Error("This donation is no longer available.");
          error.status = 409;
          throw error;
        }
        const meals = listing.unit === "meals" ? listing.quantity : Math.ceil(listing.quantity * 2);
        const receiverUpdate = await User.updateOne(
          {
            _id: req.user._id,
            role: "receiver",
            verified: true,
            $expr: {
              $gte: [
                { $subtract: ["$capacityMeals", "$reservedMeals"] },
                meals,
              ],
            },
          },
          { $inc: { reservedMeals: meals } },
          { session },
        );
        if (receiverUpdate.modifiedCount !== 1) {
          const error = new Error("Your remaining acceptance capacity is too low for this donation.");
          error.status = 409;
          throw error;
        }
        const lockedListing = await FoodListing.findOneAndUpdate(
          {
            _id: listing._id,
            status: "available",
            availableQuantity: listing.quantity,
            expiresAt: { $gt: new Date() },
          },
          {
            $set: {
              status: "claimed",
              claimedBy: req.user._id,
              availableQuantity: 0,
            },
          },
          { new: true, session },
        );
        if (!lockedListing) {
          const error = new Error("This donation has just been claimed by another organization.");
          error.status = 409;
          throw error;
        }
        [match] = await Match.create(
          [
            {
              listing: lockedListing._id,
              donor: lockedListing.donor,
              receiver: req.user._id,
              meals,
              co2Kg: Number((meals * 2.5).toFixed(2)),
            },
          ],
          { session },
        );
        listingSnapshot = lockedListing;
      });
      const populated = await Match.findById(match._id)
        .populate("listing")
        .populate("donor", "name organization phone location")
        .populate("receiver", "name organization phone location");
      notifyAvailableVolunteers(
        listingSnapshot,
        populated.donor,
        populated.receiver,
      ).catch((error) => {
        console.error("Volunteer SMS dispatch failed:", error.message);
      });
      return res.status(201).json({ match: populated });
    } catch (error) {
      return next(error);
    } finally {
      await session.endSession();
    }
  },
);

router.get("/matches/mine", authMiddleware, async (req, res, next) => {
  try {
    const filter =
      req.user.role === "donor"
        ? { donor: req.user._id }
        : req.user.role === "receiver"
          ? { receiver: req.user._id }
          : req.user.role === "volunteer"
            ? { volunteer: req.user._id }
            : {};
    const matches = await Match.find(filter)
      .sort({ createdAt: -1 })
      .populate("listing")
      .populate("donor", "name organization phone location")
      .populate("receiver", "name organization phone location")
      .populate("volunteer", "name phone");
    return res.json({ matches });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/disputes",
  authMiddleware,
  roleMiddleware("donor", "receiver", "volunteer"),
  validateBody(
    z.object({
      matchId: z.string().regex(/^[a-f\d]{24}$/i),
      reason: z.enum(["food-safety", "delivery", "quantity", "conduct", "other"]),
      description: z.string().trim().min(10).max(1000),
    }),
  ),
  async (req, res, next) => {
    try {
      const match = await Match.findById(req.validatedBody.matchId);
      if (
        !match ||
        ![match.donor, match.receiver, match.volunteer]
          .filter(Boolean)
          .some((participant) => participant.equals(req.user._id))
      ) {
        return res.status(404).json({ message: "A route you are part of could not be found." });
      }
      const dispute = await Dispute.create({
        match: match._id,
        createdBy: req.user._id,
        reason: req.validatedBody.reason,
        description: req.validatedBody.description,
      });
      return res.status(201).json({ dispute });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/volunteer/available",
  authMiddleware,
  roleMiddleware("volunteer"),
  async (_req, res, next) => {
    try {
      const matches = await Match.find({ status: "claimed", volunteer: null })
        .sort({ createdAt: 1 })
        .populate("listing")
        .populate("donor", "name organization phone location")
        .populate("receiver", "name organization phone location");
      return res.json({ matches });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/volunteer/:matchId/assign",
  authMiddleware,
  roleMiddleware("volunteer"),
  validateBody(z.object({}).strict()),
  async (req, res, next) => {
    try {
      const match = await Match.findOneAndUpdate(
        { _id: req.params.matchId, status: "claimed", volunteer: null },
        { $set: { volunteer: req.user._id } },
        { new: true },
      )
        .populate("listing")
        .populate("donor", "name organization location")
        .populate("receiver", "name organization location");
      if (!match) {
        return res.status(409).json({ message: "This route was already assigned to another volunteer." });
      }
      return res.json({ match });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  "/matches/:matchId/status",
  authMiddleware,
  roleMiddleware("volunteer"),
  validateBody(z.object({ status: z.enum(["picked_up", "delivered"]) })),
  async (req, res, next) => {
    let session;
    try {
      const expectedStatus = req.validatedBody.status === "picked_up" ? "claimed" : "picked_up";
      if (req.validatedBody.status === "picked_up") {
        const pickedUp = await Match.findOneAndUpdate(
          {
            _id: req.params.matchId,
            volunteer: req.user._id,
            status: expectedStatus,
          },
          { $set: { status: "picked_up" } },
          { new: true },
        ).populate("listing");
        if (!pickedUp) {
          return res.status(409).json({ message: "The route status has changed. Refresh and try again." });
        }
        return res.json({ match: pickedUp });
      }

      session = await Match.startSession();
      let delivered;
      await session.withTransaction(async () => {
        const match = await Match.findOneAndUpdate(
          {
            _id: req.params.matchId,
            volunteer: req.user._id,
            status: expectedStatus,
          },
          { $set: { status: "delivered" } },
          { new: true, session },
        );
        if (!match) {
          const error = new Error("The route status has changed. Refresh and try again.");
          error.status = 409;
          throw error;
        }
        const capacity = await User.updateOne(
          { _id: match.receiver, reservedMeals: { $gte: match.meals } },
          { $inc: { reservedMeals: -match.meals } },
          { session },
        );
        if (capacity.modifiedCount !== 1) {
          throw new Error("The receiver capacity reservation could not be released.");
        }
        delivered = match;
      });
      await delivered.populate("listing");
      return res.json({ match: delivered });
    } catch (error) {
      return next(error);
    } finally {
      if (session) await session.endSession();
    }
  },
);

router.get("/impact", authMiddleware, async (req, res, next) => {
  try {
    const scope = req.user.role === "admin" ? {} : { donor: req.user._id };
    const [listingStats] = await FoodListing.aggregate([
      { $match: scope },
      {
        $group: {
          _id: null,
          activeDonations: {
            $sum: { $cond: [{ $eq: ["$status", "available"] }, 1, 0] },
          },
          activeMeals: {
            $sum: {
              $cond: [
                { $eq: ["$status", "available"] },
                { $cond: [{ $eq: ["$unit", "meals"] }, "$availableQuantity", { $multiply: ["$availableQuantity", 2] }] },
                0,
              ],
            },
          },
        },
      },
    ]);
    const matchScope = req.user.role === "admin" ? {} : { donor: req.user._id };
    const [matchStats] = await Match.aggregate([
      { $match: matchScope },
      {
        $group: {
          _id: null,
          mealsSaved: {
            $sum: {
              $cond: [{ $eq: ["$status", "delivered"] }, "$meals", 0],
            },
          },
          co2Kg: {
            $sum: {
              $cond: [{ $eq: ["$status", "delivered"] }, "$co2Kg", 0],
            },
          },
          activeMatches: {
            $sum: { $cond: [{ $ne: ["$status", "delivered"] }, 1, 0] },
          },
        },
      },
    ]);
    const mealsSaved = matchStats?.mealsSaved || 0;
    return res.json({
      mealsSaved,
      activeDonations: listingStats?.activeDonations || 0,
      activeMeals: listingStats?.activeMeals || 0,
      activeMatches: matchStats?.activeMatches || 0,
      co2Kg: Number((matchStats?.co2Kg || 0).toFixed(1)),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/impact/report", authMiddleware, async (req, res, next) => {
  try {
    const filter = req.user.role === "admin" ? {} : { donor: req.user._id };
    const matches = await Match.find({ ...filter, status: "delivered" })
      .populate("listing", "title")
      .populate("receiver", "organization name")
      .sort({ createdAt: -1 })
      .limit(100);
    const mealsSaved = matches.reduce((total, match) => total + match.meals, 0);
    const doc = new PDFDocument({ margin: 54, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="ecobite-impact-report.pdf"');
    doc.pipe(res);
    doc.fontSize(26).fillColor("#166534").text("EcoBite impact report");
    doc.moveDown(0.5).fontSize(11).fillColor("#475569")
      .text(`Prepared for ${req.user.organization || req.user.name}`)
      .text(`Generated ${new Date().toLocaleDateString()}`);
    doc.moveDown(1.5).fontSize(16).fillColor("#0f172a").text("Impact summary");
    doc.moveDown(0.5).fontSize(12)
      .text(`Meals rescued: ${mealsSaved.toLocaleString()}`)
      .text(`Estimated CO2 avoided: ${(mealsSaved * 2.5).toFixed(1)} kg`)
      .text(`Delivered donations: ${matches.length}`);
    doc.moveDown(1.5).fontSize(16).text("Recent redistributions");
    matches.slice(0, 14).forEach((match) => {
      doc.moveDown(0.45).fontSize(10).fillColor("#334155").text(
        `${new Date(match.createdAt).toLocaleDateString()}  |  ${match.listing?.title || "Food donation"}  |  ${match.meals} meals  |  ${match.receiver?.organization || match.receiver?.name || "Partner NGO"}  |  ${match.status.replace("_", " ")}`,
      );
    });
    doc.end();
  } catch (error) {
    return next(error);
  }
});

router.get("/admin/overview", authMiddleware, roleMiddleware("admin"), async (_req, res, next) => {
  try {
    const [settings, pendingReceivers, donors, volunteers, activeClaims, openDisputes] = await Promise.all([
      SystemSettings.findOne({ key: "global" }).lean(),
      User.find({ role: "receiver", verificationStatus: "pending" }).select("name email organization createdAt location"),
      User.countDocuments({ role: "donor" }),
      User.countDocuments({ role: "volunteer" }),
      Match.countDocuments({ status: { $ne: "delivered" } }),
      Dispute.countDocuments({ status: "open" }),
    ]);
    return res.json({
      emergencyPause: settings?.emergency_pause ?? false,
      pendingReceivers,
      donors,
      volunteers,
      activeClaims,
      openDisputes,
    });
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/admin/system",
  authMiddleware,
  roleMiddleware("admin"),
  validateBody(z.object({ emergencyPause: z.boolean() })),
  async (req, res, next) => {
    try {
      const settings = await SystemSettings.findOneAndUpdate(
        { key: "global" },
        {
          $set: {
            emergency_pause: req.validatedBody.emergencyPause,
            updatedBy: req.user._id,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      return res.json({ emergencyPause: settings.emergency_pause });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  "/admin/users/:userId/verify",
  authMiddleware,
  roleMiddleware("admin"),
  validateBody(z.object({ verified: z.boolean() })),
  async (req, res, next) => {
    try {
      const user = await User.findOneAndUpdate(
        { _id: req.params.userId, role: "receiver" },
        {
          $set: {
            verified: req.validatedBody.verified,
            verificationStatus: req.validatedBody.verified ? "verified" : "rejected",
          },
        },
        { new: true },
      );
      if (!user) return res.status(404).json({ message: "Receiver account was not found." });
      return res.json({ user: publicUser(user) });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/admin/disputes",
  authMiddleware,
  roleMiddleware("admin"),
  async (_req, res, next) => {
    try {
      const disputes = await Dispute.find()
        .sort({ status: 1, createdAt: -1 })
        .populate("match", "status meals")
        .populate("createdBy", "name organization role")
        .limit(100);
      return res.json({ disputes });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  "/admin/disputes/:disputeId/resolve",
  authMiddleware,
  roleMiddleware("admin"),
  validateBody(z.object({ resolution: z.string().trim().min(5).max(1000) })),
  async (req, res, next) => {
    try {
      const dispute = await Dispute.findOneAndUpdate(
        { _id: req.params.disputeId, status: "open" },
        {
          $set: {
            status: "resolved",
            resolution: req.validatedBody.resolution,
            resolvedBy: req.user._id,
            resolvedAt: new Date(),
          },
        },
        { new: true },
      );
      if (!dispute) return res.status(404).json({ message: "Open dispute was not found." });
      return res.json({ dispute });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
