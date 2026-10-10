import {
  IncidentRepository,
  incidentRepository,
} from "./incident.repository";
import { AppError } from "../../common/errors/app-error";
import { ERROR_CODE } from "../../common/errors/error-code";
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
import {
  INCIDENT_STATUS,
  EVIDENCE_ACCESS_ACTION,
} from "../../common/constants/incident.constant";

export class IncidentService {
  private readonly repository: IncidentRepository;

  constructor(repository?: IncidentRepository) {
    this.repository = repository || incidentRepository;
  }

  // ── Incident CRUD Operations ───────────────────────────────────────────────
  async createIncident(data: CreateIncidentDto, actorId: string) {
    return this.repository.createIncident(data, actorId);
  }

  async getIncidentById(id: string) {
    const incident = await this.repository.findIncidentById(id);
    if (!incident) {
      throw new AppError(
        "Không tìm thấy sự cố vi phạm",
        404,
        ERROR_CODE.INCIDENT_NOT_FOUND,
      );
    }
    return incident;
  }

  async getAllIncidents(query: IncidentQueryDto) {
    if (
      query.search?.trim() &&
      typeof this.repository.searchFts === "function"
    ) {
      return this.repository.searchFts(query);
    }
    return this.repository.findAllIncidents(query);
  }

  async updateIncident(id: string, data: UpdateIncidentDto) {
    const incident = await this.getIncidentById(id);

    if (incident.status === INCIDENT_STATUS.CLOSED) {
      throw new AppError(
        "Không thể cập nhật thông tin sự cố đã đóng",
        400,
        ERROR_CODE.BAD_REQUEST,
      );
    }

    return this.repository.updateIncident(id, data);
  }

  async deleteIncident(id: string) {
    await this.getIncidentById(id);
    return this.repository.deleteIncident(id);
  }

  // ── Incident Lifecycle Transitions ─────────────────────────────────────────
  async reviewIncident(id: string, dto: ReviewIncidentDto, actorId: string) {
    const incident = await this.getIncidentById(id);

    if (incident.status !== INCIDENT_STATUS.PENDING_REVIEW) {
      throw new AppError(
        `Chỉ có thể duyệt sự cố đang ở trạng thái PENDING_REVIEW (hiện tại: ${incident.status})`,
        400,
        ERROR_CODE.INVALID_STATUS_TRANSITION,
      );
    }

    const newStatus =
      dto.decision === "CONFIRMED"
        ? INCIDENT_STATUS.CONFIRMED
        : INCIDENT_STATUS.DISMISSED;

    const reason =
      dto.decision === "CONFIRMED"
        ? dto.reason || "Xác nhận vi phạm quy chuẩn an toàn PPE"
        : dto.reason;

    return this.repository.transitionStatus({
      incidentId: id,
      oldStatus: incident.status,
      newStatus,
      changedBy: actorId,
      reason,
    });
  }

  async resolveIncident(id: string, dto: ResolveIncidentDto, actorId: string) {
    const incident = await this.getIncidentById(id);

    if (incident.status !== INCIDENT_STATUS.CONFIRMED) {
      throw new AppError(
        `Chỉ có thể giải quyết sự cố đã được xác nhận vi phạm (CONFIRMED). Trạng thái hiện tại: ${incident.status}`,
        400,
        ERROR_CODE.INVALID_STATUS_TRANSITION,
      );
    }

    return this.repository.transitionStatus({
      incidentId: id,
      oldStatus: incident.status,
      newStatus: INCIDENT_STATUS.RESOLVED,
      changedBy: actorId,
      reason: dto.resolutionNote,
      resolvedAt: new Date(),
    });
  }

  async closeIncident(id: string, dto: CloseIncidentDto, actorId: string) {
    const incident = await this.getIncidentById(id);

    if (
      incident.status !== INCIDENT_STATUS.RESOLVED &&
      incident.status !== INCIDENT_STATUS.DISMISSED
    ) {
      throw new AppError(
        `Chỉ có thể đóng sự cố đã được giải quyết (RESOLVED) hoặc đã bị bác bỏ (DISMISSED). Trạng thái hiện tại: ${incident.status}`,
        400,
        ERROR_CODE.INVALID_STATUS_TRANSITION,
      );
    }

    return this.repository.transitionStatus({
      incidentId: id,
      oldStatus: incident.status,
      newStatus: INCIDENT_STATUS.CLOSED,
      changedBy: actorId,
      reason: dto.closeNote || "Đóng hồ sơ sự cố an toàn",
    });
  }

  // ── Assignment & Comment Operations ────────────────────────────────────────
  async assignIncident(id: string, dto: CreateIncidentAssignmentDto) {
    const incident = await this.getIncidentById(id);

    if (
      incident.status === INCIDENT_STATUS.CLOSED ||
      incident.status === INCIDENT_STATUS.DISMISSED
    ) {
      throw new AppError(
        `Không thể phân công xử lý sự cố đã ở trạng thái ${incident.status}`,
        400,
        ERROR_CODE.BAD_REQUEST,
      );
    }

    return this.repository.assignIncident(id, dto.assignedTo);
  }

  async getIncidentAssignments(id: string) {
    await this.getIncidentById(id);
    return this.repository.findAssignmentsByIncidentId(id);
  }

  async addIncidentComment(
    id: string,
    dto: CreateIncidentCommentDto,
    actorId: string,
  ) {
    await this.getIncidentById(id);
    return this.repository.addComment(id, actorId, dto.comment);
  }

  async getIncidentComments(id: string) {
    await this.getIncidentById(id);
    return this.repository.findCommentsByIncidentId(id);
  }

  // ── Evidence Operations ────────────────────────────────────────────────────
  async addEvidence(incidentId: string, dto: CreateEvidenceDto) {
    const incident = await this.getIncidentById(incidentId);

    if (incident.status === INCIDENT_STATUS.CLOSED) {
      throw new AppError(
        "Không thể đính kèm bằng chứng vào sự cố đã đóng",
        400,
        ERROR_CODE.BAD_REQUEST,
      );
    }

    return this.repository.createEvidence({
      ...dto,
      incidentId,
    });
  }

  async getEvidenceById(id: string, actorId?: string) {
    const evidence = await this.repository.findEvidenceById(id);
    if (!evidence) {
      throw new AppError(
        "Không tìm thấy bằng chứng vi phạm",
        404,
        ERROR_CODE.EVIDENCE_NOT_FOUND,
      );
    }

    if (actorId) {
      // Ghi nhận log truy cập bằng chứng không đồng bộ, không chặn luồng trả dữ liệu
      this.repository
        .logEvidenceAccess({
          evidenceId: id,
          userId: actorId,
          action: EVIDENCE_ACCESS_ACTION.VIEW,
        })
        .catch((err) => {
          console.error("Không thể ghi log truy cập bằng chứng:", err);
        });
    }

    return evidence;
  }

  async getAllEvidences(query: EvidenceQueryDto) {
    return this.repository.findAllEvidences(query);
  }

  async deleteEvidence(id: string) {
    await this.getEvidenceById(id);
    return this.repository.deleteEvidence(id);
  }
}

export const incidentService = new IncidentService();
