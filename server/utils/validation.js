const { z } = require("zod");

const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(8).max(128),
  role: z.enum(["donor", "receiver", "volunteer"]),
  organization: z.string().trim().max(120).optional().default(""),
  phone: z.string().trim().max(30).optional().default(""),
  location: coordinatesSchema,
  serviceRadiusKm: z.number().min(1).max(100).optional().default(10),
  capacityMeals: z.number().int().min(1).max(1000000).optional().default(250),
});

const loginSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(128),
});

const listingSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(500).optional().default(""),
    quantity: z.number().int().min(1).max(100000),
    unit: z.enum(["meals", "kg"]),
    foodType: z.enum(["cooked", "raw", "packaged"]),
    location: coordinatesSchema,
    preparedAt: z.coerce.date(),
    expiresAt: z.coerce.date(),
    temperatureControlled: z.boolean(),
    allergens: z.array(z.enum(["Vegan", "Halal", "Jain", "Nut-free"])).max(4),
    liabilityWaiver: z.literal(true),
  })
  .superRefine((listing, context) => {
    const windowMs = listing.expiresAt.getTime() - listing.preparedAt.getTime();
    if (windowMs < 2 * 60 * 60 * 1000 || windowMs > 4 * 60 * 60 * 1000) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Safe-consumption time must be between 2 and 4 hours after preparation.",
      });
    }
    if (listing.preparedAt.getTime() > Date.now()) {
      context.addIssue({
        code: "custom",
        path: ["preparedAt"],
        message: "Preparation time cannot be in the future.",
      });
    }
    if (listing.expiresAt.getTime() <= Date.now()) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Food must not be expired when it is listed.",
      });
    }
  });

module.exports = { registerSchema, loginSchema, listingSchema };
