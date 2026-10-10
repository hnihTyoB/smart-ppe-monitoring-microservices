import { Request, Response, NextFunction } from "express";
import { IncidentService, incidentService } from "./incident.service";
import {
  CreateIncidentDto,
  UpdateIncidentDto,
  IncidentQueryDto,
  ReviewIncidentDto,
  ResolveIncidentDto,
  CloseIncidentDto,
  CreateIncidentAssignmentDto,
  CreateIncidentCommentDto,
  CreateEvidenceDto,
  EvidenceQueryDto,
} from "./incident.dto";

function getActorId(req: Request): string {
  return req.user?.id || "";
}

export class IncidentController {
  private readonly service: IncidentService;

  constructor(service?: IncidentService) {
    this.service = service || incidentService;
  }

  // ── Incident CRUD ──────────────────────────────────────────────────────────
  createIncident = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actorId = getActorId(req);
      const body = req.body as CreateIncidentDto;
      const result = await this.service.createIncident(body, actorId);
      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  findIncidentById = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const result = await this.service.getIncidentById(id);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  findAllIncidents = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const query = req.query as unknown as IncidentQueryDto;
      const result = await this.service.getAllIncidents(query);
      res.json({
        success: true,
        data: result.data,
        meta: result.meta,
      });
    } catch (error) {
      next(error);
    }
  };

  updateIncident = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const body = req.body as UpdateIncidentDto;
      const result = await this.service.updateIncident(id, body);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  deleteIncident = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const result = await this.service.deleteIncident(id);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // ── Lifecycle Transitions ──────────────────────────────────────────────────
  reviewIncident = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const actorId = getActorId(req);
      const body = req.body as ReviewIncidentDto;
      const result = await this.service.reviewIncident(id, body, actorId);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  resolveIncident = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const actorId = getActorId(req);
      const body = req.body as ResolveIncidentDto;
      const result = await this.service.resolveIncident(id, body, actorId);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  closeIncident = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const actorId = getActorId(req);
      const body = req.body as CloseIncidentDto;
      const result = await this.service.closeIncident(id, body, actorId);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // ── Assignment & Comments ──────────────────────────────────────────────────
  assignIncident = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const body = req.body as CreateIncidentAssignmentDto;
      const result = await this.service.assignIncident(id, body);
      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  getIncidentAssignments = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const result = await this.service.getIncidentAssignments(id);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  addIncidentComment = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const actorId = getActorId(req);
      const body = req.body as CreateIncidentCommentDto;
      const result = await this.service.addIncidentComment(id, body, actorId);
      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  getIncidentComments = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const result = await this.service.getIncidentComments(id);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // ── Evidence Endpoints ─────────────────────────────────────────────────────
  addEvidence = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const body = req.body as CreateEvidenceDto;
      const result = await this.service.addEvidence(id, body);
      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  findEvidenceById = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const actorId = req.user?.id;
      const result = await this.service.getEvidenceById(id, actorId);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  findAllEvidences = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const query = req.query as unknown as EvidenceQueryDto;
      const result = await this.service.getAllEvidences(query);
      res.json({
        success: true,
        data: result.data,
        meta: result.meta,
      });
    } catch (error) {
      next(error);
    }
  };

  deleteEvidence = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const result = await this.service.deleteEvidence(id);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const incidentController = new IncidentController();
