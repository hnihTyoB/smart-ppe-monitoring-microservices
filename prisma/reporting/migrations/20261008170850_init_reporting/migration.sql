-- CreateTable
CREATE TABLE "report_templates" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "name" VARCHAR(150) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "file_path" TEXT,
    "file_name" VARCHAR(255),
    "file_type" VARCHAR(30) NOT NULL DEFAULT 'PDF',
    "version" VARCHAR(30) NOT NULL DEFAULT '1.0.0',
    "status" VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_generations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "template_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "report_type" VARCHAR(50) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "generated_by" UUID NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'COMPLETED',
    "file_path" TEXT,
    "file_name" VARCHAR(255),
    "error_message" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_statistics" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "site_id" UUID NOT NULL,
    "camera_id" UUID,
    "violation_type" VARCHAR(50) NOT NULL,
    "severity" VARCHAR(30) NOT NULL,
    "stat_date" DATE NOT NULL,
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "confirmed_count" INTEGER NOT NULL DEFAULT 0,
    "resolved_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_statistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_statistics" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "site_id" UUID NOT NULL,
    "stat_date" DATE NOT NULL,
    "total_incidents" INTEGER NOT NULL DEFAULT 0,
    "open_incidents" INTEGER NOT NULL DEFAULT 0,
    "resolved_incidents" INTEGER NOT NULL DEFAULT 0,
    "false_alarms" INTEGER NOT NULL DEFAULT 0,
    "true_violations" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incident_statistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_performance_statistics" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "camera_id" UUID NOT NULL,
    "model_version_id" UUID,
    "stat_date" DATE NOT NULL,
    "avg_fps" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "avg_latency_ms" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "max_latency_ms" INTEGER NOT NULL DEFAULT 0,
    "total_frames" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_performance_statistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "name" VARCHAR(150) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "model_type" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "status" VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_versions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "model_id" UUID NOT NULL,
    "version" VARCHAR(30) NOT NULL,
    "model_path" TEXT,
    "framework" VARCHAR(50) NOT NULL DEFAULT 'PyTorch',
    "input_size" VARCHAR(30) NOT NULL DEFAULT '640x640',
    "status" VARCHAR(30) NOT NULL DEFAULT 'DEPLOYED',
    "metrics" JSONB,
    "deployed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "report_templates_code_key" ON "report_templates"("code");

-- CreateIndex
CREATE INDEX "report_generations_site_id_generated_at_idx" ON "report_generations"("site_id", "generated_at");

-- CreateIndex
CREATE INDEX "report_statistics_site_id_stat_date_idx" ON "report_statistics"("site_id", "stat_date");

-- CreateIndex
CREATE UNIQUE INDEX "incident_statistics_site_id_stat_date_key" ON "incident_statistics"("site_id", "stat_date");

-- CreateIndex
CREATE INDEX "ai_performance_statistics_camera_id_stat_date_idx" ON "ai_performance_statistics"("camera_id", "stat_date");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_code_key" ON "ai_models"("code");

-- CreateIndex
CREATE INDEX "ai_model_versions_model_id_idx" ON "ai_model_versions"("model_id");

-- AddForeignKey
ALTER TABLE "report_generations" ADD CONSTRAINT "report_generations_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "report_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_versions" ADD CONSTRAINT "ai_model_versions_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;
