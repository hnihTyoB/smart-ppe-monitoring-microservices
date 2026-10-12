import { Router } from "express";
import { siteController } from "./site.controller";
import { verifyJwtLocally } from "../../middlewares/verify-jwt-locally.middleware";
import { requirePermission } from "../../middlewares/permission.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { PERMISSIONS } from "../../common/constants/permission.constant";
import {
  siteIdParamSchema,
  zoneIdParamSchema,
  restrictedAreaIdParamSchema,
  createSiteSchema,
  updateSiteSchema,
  siteQuerySchema,
  createZoneSchema,
  createZoneDirectSchema,
  updateZoneSchema,
  zoneQuerySchema,
  updateSiteSafetyConfigSchema,
  createRestrictedAreaSchema,
  createRestrictedAreaDirectSchema,
  updateRestrictedAreaSchema,
  restrictedAreaQuerySchema,
} from "./site.validation";

// ── Site Routes (/api/v1/sites) ──────────────────────────────────────────────
export const siteRouter = Router();

siteRouter.get(
  "/",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_SITE_READ),
  validate(siteQuerySchema, "query"),
  siteController.findAllSites,
);

siteRouter.post(
  "/",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_SITE_MANAGE),
  validate(createSiteSchema),
  siteController.createSite,
);

siteRouter.get(
  "/:id",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_SITE_READ),
  validate(siteIdParamSchema, "params"),
  siteController.findSiteById,
);

siteRouter.put(
  "/:id",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_SITE_MANAGE),
  validate(siteIdParamSchema, "params"),
  validate(updateSiteSchema),
  siteController.updateSite,
);

siteRouter.delete(
  "/:id",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_SITE_MANAGE),
  validate(siteIdParamSchema, "params"),
  siteController.deleteSite,
);

// Safety Config
siteRouter.get(
  "/:id/safety-config",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_SAFETY_CONFIG_READ),
  validate(siteIdParamSchema, "params"),
  siteController.getSafetyConfig,
);

siteRouter.put(
  "/:id/safety-config",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_SAFETY_CONFIG_MANAGE),
  validate(siteIdParamSchema, "params"),
  validate(updateSiteSafetyConfigSchema),
  siteController.updateSafetyConfig,
);

// Nested Site Zones
siteRouter.get(
  "/:id/zones",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_ZONE_READ),
  validate(siteIdParamSchema, "params"),
  validate(zoneQuerySchema, "query"),
  siteController.getSiteZones,
);

siteRouter.post(
  "/:id/zones",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_ZONE_MANAGE),
  validate(siteIdParamSchema, "params"),
  validate(createZoneSchema.omit({ siteId: true })),
  siteController.createSiteZone,
);

// Nested Site Restricted Areas
siteRouter.get(
  "/:id/restricted-areas",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_RESTRICTED_AREA_READ),
  validate(siteIdParamSchema, "params"),
  validate(restrictedAreaQuerySchema, "query"),
  siteController.getSiteRestrictedAreas,
);

siteRouter.post(
  "/:id/restricted-areas",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_RESTRICTED_AREA_MANAGE),
  validate(siteIdParamSchema, "params"),
  validate(createRestrictedAreaSchema.omit({ siteId: true })),
  siteController.createSiteRestrictedArea,
);

// ── Zone Routes (/api/v1/zones) ──────────────────────────────────────────────
export const zoneRouter = Router();

zoneRouter.get(
  "/",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_ZONE_READ),
  validate(zoneQuerySchema, "query"),
  siteController.findAllZones,
);

zoneRouter.post(
  "/",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_ZONE_MANAGE),
  validate(createZoneDirectSchema),
  siteController.createZone,
);

zoneRouter.get(
  "/:id",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_ZONE_READ),
  validate(zoneIdParamSchema, "params"),
  siteController.findZoneById,
);

zoneRouter.put(
  "/:id",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_ZONE_MANAGE),
  validate(zoneIdParamSchema, "params"),
  validate(updateZoneSchema),
  siteController.updateZone,
);

zoneRouter.delete(
  "/:id",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_ZONE_MANAGE),
  validate(zoneIdParamSchema, "params"),
  siteController.deleteZone,
);

zoneRouter.get(
  "/:id/restricted-areas",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_RESTRICTED_AREA_READ),
  validate(zoneIdParamSchema, "params"),
  validate(restrictedAreaQuerySchema, "query"),
  siteController.getZoneRestrictedAreas,
);

// ── Restricted Area Routes (/api/v1/restricted-areas) ─────────────────────────
export const restrictedAreaRouter = Router();

restrictedAreaRouter.get(
  "/",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_RESTRICTED_AREA_READ),
  validate(restrictedAreaQuerySchema, "query"),
  siteController.findAllRestrictedAreas,
);

restrictedAreaRouter.post(
  "/",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_RESTRICTED_AREA_MANAGE),
  validate(createRestrictedAreaDirectSchema),
  siteController.createRestrictedArea,
);

restrictedAreaRouter.get(
  "/:id",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_RESTRICTED_AREA_READ),
  validate(restrictedAreaIdParamSchema, "params"),
  siteController.findRestrictedAreaById,
);

restrictedAreaRouter.put(
  "/:id",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_RESTRICTED_AREA_MANAGE),
  validate(restrictedAreaIdParamSchema, "params"),
  validate(updateRestrictedAreaSchema),
  siteController.updateRestrictedArea,
);

restrictedAreaRouter.delete(
  "/:id",
  verifyJwtLocally,
  requirePermission(PERMISSIONS.PPE_RESTRICTED_AREA_MANAGE),
  validate(restrictedAreaIdParamSchema, "params"),
  siteController.deleteRestrictedArea,
);
