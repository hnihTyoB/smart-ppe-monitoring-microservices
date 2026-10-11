import { openapiRegistry } from "../../config/openapi/openapi.registry";
import {
  aiVisionIngestEventSchema,
  aiVisionBatchIngestSchema,
  aiVisionSimulateSchema,
} from "./ai-vision.validation";
import { z } from "zod";

export function registerAiVisionOpenApi(): void {
  openapiRegistry.register(
    "AiVisionIngestEventRequest",
    aiVisionIngestEventSchema,
  );
  openapiRegistry.register(
    "AiVisionBatchIngestRequest",
    aiVisionBatchIngestSchema,
  );
  openapiRegistry.register(
    "AiVisionSimulateRequest",
    aiVisionSimulateSchema,
  );

  // 1. POST /integration/ai-vision/events
  openapiRegistry.registerPath({
    method: "post",
    path: "/integration/ai-vision/events",
    tags: ["AI Vision Integration"],
    summary:
      "Tiếp nhận sự kiện vi phạm an toàn từ AI Vision Edge Pipeline (ALL-03 / VI-11)",
    description:
      "Cửa ngõ tích hợp dành cho thiết bị Edge AI (Python - SV2). Hỗ trợ xác thực qua API Key (header x-api-key) hoặc JWT. Tự động làm giàu thông tin Camera/Site (Auto-Enrichment), khử trùng lặp (Idempotency), bóc tách URL bằng chứng và tạo Incident trong CSDL. Hỗ trợ query ?sync=true để nhận ngay thông tin Incident đã tạo.",
    security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
    request: {
      query: z.object({
        sync: z
          .enum(["true", "false", "1", "0"])
          .optional()
          .openapi({ description: "Chế độ đồng bộ: Chờ tạo Incident trong CSDL" }),
      }),
      body: {
        content: {
          "application/json": {
            schema: aiVisionIngestEventSchema,
          },
        },
      },
    },
    responses: {
      202: {
        description: "Sự kiện hợp lệ đã được tiếp nhận và đưa vào hàng đợi xử lý ngầm (Async Mode)",
      },
      201: {
        description: "Sự kiện đã được xử lý và tạo thành công Incident trong CSDL (Sync Mode)",
      },
      200: {
        description: "Sự kiện trùng lặp đã từng được xử lý trong vòng 24 giờ",
      },
      404: {
        description: "Camera hoặc công trường không tồn tại trong hệ thống",
      },
      422: {
        description: "Dữ liệu sự kiện vi phạm không đúng định dạng",
      },
    },
  });

  // 2. POST /integration/ai-vision/events/batch
  openapiRegistry.registerPath({
    method: "post",
    path: "/integration/ai-vision/events/batch",
    tags: ["AI Vision Integration"],
    summary:
      "Nạp hàng loạt sự kiện lưu tạm từ Edge AI (Local Offline Buffer Recovery)",
    description:
      "Tiếp nhận mảng tối đa 50 sự kiện khi đường truyền mạng tại công trường phục hồi sau sự cố gián đoạn kết nối.",
    security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: aiVisionBatchIngestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Báo cáo tổng hợp số lượng sự kiện đã xử lý (ingested, duplicates, failed)",
      },
      422: {
        description: "Mảng sự kiện rỗng hoặc vượt quá giới hạn 50 phần tử",
      },
    },
  });

  // 3. POST /integration/ai-vision/simulate
  openapiRegistry.registerPath({
    method: "post",
    path: "/integration/ai-vision/simulate",
    tags: ["AI Vision Integration"],
    summary:
      "Giả lập sự kiện vi phạm an toàn PPE (Live Demo & Testing Rehearsal)",
    description:
      "Tự động tạo sự kiện vi phạm mẫu theo kịch bản chỉ định (No-Helmet, No-Vest...) và kích hoạt đường ống tạo Incident tức thì mà không cần camera vật lý.",
    security: [{ BearerAuth: [] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: aiVisionSimulateSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: "Mô phỏng sự kiện và tạo Incident thành công",
      },
    },
  });

  // 4. GET /integration/ai-vision/contract
  openapiRegistry.registerPath({
    method: "get",
    path: "/integration/ai-vision/contract",
    tags: ["AI Vision Integration"],
    summary:
      "Xuất bản tài liệu đặc tả Hợp đồng dữ liệu ALL-03 / VI-11 (JSON Schema Spec)",
    description:
      "Cung cấp schema và các mẫu payload cho lập trình viên Python (SV2) đối chiếu tích hợp trực tiếp.",
    responses: {
      200: {
        description: "Đặc tả hợp đồng dữ liệu hợp chuẩn",
      },
    },
  });

  // 5. GET /integration/ai-vision/health
  openapiRegistry.registerPath({
    method: "get",
    path: "/integration/ai-vision/health",
    tags: ["AI Vision Integration"],
    summary:
      "Kiểm tra sức khỏe và độ sẵn sàng của đường ống tích hợp AI Vision",
    description:
      "Kiểm tra trạng thái kết nối tới Camera DB, Site DB, Incident DB và Message Broker.",
    responses: {
      200: {
        description: "Đường ống sẵn sàng hoạt động (UP)",
      },
      503: {
        description: "Có thành phần phụ thuộc bị mất kết nối (DOWN/DEGRADED)",
      },
    },
  });
}
