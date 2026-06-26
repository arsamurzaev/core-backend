-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AttributeEnumValueSource" AS ENUM ('MANUAL', 'AUTO', 'IMPORTED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'ADMIN', 'SYSTEM', 'INTEGRATION', 'JOB', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED', 'VALIDATION_ERROR');

-- CreateEnum
CREATE TYPE "AuditSeverity" AS ENUM ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CATALOG', 'USER', 'GEO_ADMIN', 'ADMIN');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('MOYSKLAD', 'IIKO', 'ONE_C');

-- CreateEnum
CREATE TYPE "IntegrationExternalObjectKind" AS ENUM ('ODATA_ENTITY', 'HTTP_ENDPOINT', 'CATALOG', 'DOCUMENT', 'REGISTER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "IntegrationMappingLocalEntity" AS ENUM ('PRODUCT', 'PRODUCT_VARIANT', 'CATEGORY', 'ORDER', 'STOCK', 'PRICE', 'WAREHOUSE', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "IntegrationMappingDirection" AS ENUM ('IMPORT', 'EXPORT', 'IMPORT_EXPORT');

-- CreateEnum
CREATE TYPE "IntegrationMappingDataType" AS ENUM ('STRING', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATETIME', 'JSON', 'REFERENCE');

-- CreateEnum
CREATE TYPE "IntegrationSyncStatus" AS ENUM ('IDLE', 'SYNCING', 'SUCCESS', 'ERROR');

-- CreateEnum
CREATE TYPE "IntegrationSyncRunMode" AS ENUM ('FULL', 'PRODUCT', 'VARIANT', 'STOCK', 'PRICE');

-- CreateEnum
CREATE TYPE "IntegrationSyncRunTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "IntegrationSyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'ERROR', 'SKIPPED');

-- CreateEnum
CREATE TYPE "IntegrationSyncSnapshotCompleteness" AS ENUM ('FULL_COMPLETE', 'PARTIAL', 'WEBHOOK_DELTA', 'FAILED_BEFORE_SNAPSHOT');

-- CreateEnum
CREATE TYPE "IntegrationWebhookEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DomainEventOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationOrderExportStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'ERROR', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ProductsDisplayMode" AS ENUM ('LIST', 'CATEGORY');

-- CreateEnum
CREATE TYPE "CatalogPresentationMode" AS ENUM ('CATALOG', 'BUSINESS_CARD');

-- CreateEnum
CREATE TYPE "CatalogExperienceMode" AS ENUM ('DELIVERY', 'BROWSE', 'HALL');

-- CreateEnum
CREATE TYPE "CatalogInventoryMode" AS ENUM ('NONE', 'EXTERNAL', 'INTERNAL');

-- CreateEnum
CREATE TYPE "InventoryWarehouseStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('INITIAL', 'RECEIPT', 'WRITE_OFF', 'SALE', 'RETURN', 'RESERVE', 'RELEASE', 'ADJUSTMENT', 'SYNC');

-- CreateEnum
CREATE TYPE "InventoryMovementSource" AS ENUM ('MANUAL', 'ORDER', 'CART', 'INTEGRATION', 'MIGRATION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "InventoryReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('REGISTRATION', 'PROPOSAL', 'IMPLEMENTATION', 'OPERATIONAL', 'REFUSAL', 'DEMO', 'PRESENTATION', 'PROMOTION');

-- CreateEnum
CREATE TYPE "CatalogDomainStatus" AS ENUM ('PENDING_DNS', 'DNS_VERIFIED', 'ACTIVE', 'FAILED', 'DISABLED');

-- CreateEnum
CREATE TYPE "CatalogSignupStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CONSUMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'ACQUIRING');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('SUBSCRIPTION', 'PROMOCODE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CartStatus" AS ENUM ('DRAFT', 'SHARED', 'IN_PROGRESS', 'PAUSED', 'CONVERTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CartTableSessionStatus" AS ENUM ('OPEN', 'PENDING_CONFIRMATION', 'SUBMITTED', 'EXPORT_ERROR', 'CLOSED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CartCheckoutMethod" AS ENUM ('DELIVERY', 'PICKUP', 'PREORDER');

-- CreateEnum
CREATE TYPE "Metric" AS ENUM ('YANDEX');

-- CreateEnum
CREATE TYPE "MetricScope" AS ENUM ('GLOBAL', 'MAIN', 'CATALOG');

-- CreateEnum
CREATE TYPE "MigrationRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MigrationIssueSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "MigrationEntityKind" AS ENUM ('BUSINESS', 'USER', 'CATALOG', 'CATALOG_CONFIG', 'CATALOG_SETTINGS', 'CATALOG_CONTACT', 'METRIC', 'INTEGRATION', 'MEDIA', 'BRAND', 'CATEGORY', 'PRODUCT', 'PAYMENT', 'PROMO_CODE', 'ORDER');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('PHONE', 'EMAIL', 'WHATSAPP', 'MAX', 'BIP', 'TELEGRAM', 'SMS', 'MAP');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED', 'HIDDEN', 'DELETE');

-- CreateEnum
CREATE TYPE "ProductVariantStatus" AS ENUM ('ACTIVE', 'OUT_OF_STOCK', 'DISABLED');

-- CreateEnum
CREATE TYPE "ProductVariantKind" AS ENUM ('DEFAULT', 'MATRIX');

-- CreateEnum
CREATE TYPE "DataType" AS ENUM ('STRING', 'INTEGER', 'DECIMAL', 'DATETIME', 'BOOLEAN', 'ENUM');

-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM ('PAGE_VIEW', 'VIEW_PRODUCT', 'PRODUCT_CLICK_FROM_LIST', 'SEARCH_SUBMIT', 'SEARCH_RESULTS', 'SEARCH_ZERO_RESULTS', 'FILTER_APPLY', 'FILTER_RESET', 'SORT_CHANGE', 'ADD_TO_CART', 'REMOVE_FROM_CART', 'BEGIN_CHECKOUT', 'CLICK_CONTACT', 'LEAD_SUBMIT', 'ERROR_CLIENT', 'ERROR_API', 'PERF');

-- CreateEnum
CREATE TYPE "AnalyticsPageType" AS ENUM ('HOME', 'CATALOG', 'CATEGORY', 'PRODUCT', 'SEARCH', 'CART', 'CHECKOUT', 'OTHER');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('MOBILE', 'DESKTOP', 'TABLET', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadChannel" AS ENUM ('FORM', 'PHONE', 'EMAIL', 'WHATSAPP', 'TELEGRAM', 'SMS', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('SUBMITTED', 'QUALIFIED', 'DISQUALIFIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SeoEntityType" AS ENUM ('CATALOG', 'CATEGORY', 'PRODUCT', 'PAGE', 'BRAND', 'ARTICLE', 'OTHER');

-- CreateEnum
CREATE TYPE "SeoChangeFreq" AS ENUM ('ALWAYS', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'NEVER');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ProductModifierScope" AS ENUM ('PRODUCT', 'VARIANT');

-- CreateEnum
CREATE TYPE "CatalogPriceListPriceTarget" AS ENUM ('PRODUCT', 'VARIANT', 'SALE_UNIT');

-- CreateEnum
CREATE TYPE "ProductTypeScope" AS ENUM ('SYSTEM_TEMPLATE', 'CATALOG');

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_sessions" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "user_id" UUID,
    "token" TEXT,
    "metrika_client_id" TEXT,
    "metrika_counter_id" TEXT,
    "device_type" "DeviceType",
    "user_agent" TEXT,
    "referrer" TEXT,
    "landing_url" TEXT,
    "utm" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" BIGSERIAL NOT NULL,
    "catalog_id" UUID NOT NULL,
    "session_id" UUID,
    "user_id" UUID,
    "type" "AnalyticsEventType" NOT NULL,
    "page_type" "AnalyticsPageType",
    "url" TEXT,
    "title" TEXT,
    "product_id" UUID,
    "category_id" UUID,
    "variant_id" UUID,
    "position" INTEGER,
    "query" TEXT,
    "results_cnt" INTEGER,
    "filters" JSONB,
    "sort" TEXT,
    "status_code" INTEGER,
    "error_name" TEXT,
    "error_msg" TEXT,
    "perf" JSONB,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "session_id" UUID,
    "user_id" UUID,
    "channel" "LeadChannel" NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'SUBMITTED',
    "product_id" UUID,
    "category_id" UUID,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "message" TEXT,
    "qualified_at" TIMESTAMP(3),
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrika_daily_stats" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "counter_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,
    "pageviews" INTEGER NOT NULL DEFAULT 0,
    "bounce_rate" DECIMAL(6,3),
    "avg_visit_duration_sec" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metrika_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrika_source_daily_stats" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "metrika_source_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attributes" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(255) NOT NULL,
    "data_type" "DataType" NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_variant_attribute" BOOLEAN NOT NULL DEFAULT false,
    "is_filterable" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribute_enum_values" (
    "id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "catalog_id" UUID,
    "value" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "business_id" TEXT,
    "source" "AttributeEnumValueSource" NOT NULL DEFAULT 'MANUAL',
    "merged_into_id" UUID,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attribute_enum_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribute_enum_value_aliases" (
    "id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "catalog_id" UUID,
    "enum_value_id" UUID NOT NULL,
    "value" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255),
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attribute_enum_value_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_attributes" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "enum_value_id" UUID NOT NULL,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variant_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "category" VARCHAR(80),
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "actor_type" "AuditActorType" NOT NULL DEFAULT 'USER',
    "actor_id" VARCHAR(191),
    "actor_user_id" UUID,
    "actor_role" "Role",
    "actor_login" VARCHAR(191),
    "actor_name" VARCHAR(255),
    "target_type" VARCHAR(100),
    "target_id" VARCHAR(191),
    "target_catalog_id" UUID,
    "target_label" VARCHAR(255),
    "request_id" VARCHAR(100),
    "correlation_id" VARCHAR(100),
    "session_id" VARCHAR(191),
    "ip" VARCHAR(64),
    "user_agent" TEXT,
    "method" VARCHAR(10),
    "host" VARCHAR(255),
    "path" VARCHAR(1024),
    "status_code" INTEGER,
    "reason" TEXT,
    "message" TEXT,
    "before" JSONB,
    "after" JSONB,
    "diff" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event_targets" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "target_type" VARCHAR(100) NOT NULL,
    "target_id" VARCHAR(191),
    "catalog_id" UUID,
    "label" VARCHAR(255),
    "snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event_changes" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "field" VARCHAR(255) NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "token" TEXT,
    "status" "CartStatus" NOT NULL DEFAULT 'DRAFT',
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "public_key" TEXT,
    "checkout_key" TEXT,
    "checkout_at" TIMESTAMP(3),
    "comment" TEXT,
    "checkout_method" "CartCheckoutMethod",
    "checkout_data" JSONB,
    "checkout_contacts" JSONB,
    "assigned_manager_id" UUID,
    "manager_session_started_at" TIMESTAMP(3),
    "manager_last_seen_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "catalog_id" UUID NOT NULL,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "base_quantity" INTEGER,
    "unit_price_snapshot" DECIMAL(12,2),
    "modifier_signature" VARCHAR(1000) NOT NULL DEFAULT '',
    "price_list_id" UUID,
    "price_list_code" VARCHAR(100),
    "price_list_name" VARCHAR(255),
    "guest_session_id" VARCHAR(64),
    "guest_name" VARCHAR(120),
    "cart_id" UUID NOT NULL,
    "variant_id" UUID,
    "sale_unit_id" UUID,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_table_sessions" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "external_table_item_id" UUID,
    "submitted_order_id" UUID,
    "provider" "IntegrationProvider" NOT NULL DEFAULT 'IIKO',
    "status" "CartTableSessionStatus" NOT NULL DEFAULT 'OPEN',
    "active_key" VARCHAR(255),
    "public_code" VARCHAR(32) NOT NULL,
    "table_external_id" VARCHAR(128) NOT NULL,
    "table_number" VARCHAR(64),
    "table_name" VARCHAR(255),
    "section_external_id" VARCHAR(128),
    "section_name" VARCHAR(255),
    "guests_count" INTEGER,
    "external_order_id" VARCHAR(128),
    "external_correlation_id" VARCHAR(128),
    "metadata" JSONB,
    "submitted_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_table_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_signups" (
    "id" UUID NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(64) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "catalog_name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(63) NOT NULL,
    "type_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "status" "CatalogSignupStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_user_id" UUID,
    "created_catalog_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_signups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogs" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT,
    "name" TEXT NOT NULL,
    "type_id" UUID NOT NULL,
    "catalog_id" UUID,
    "userId" UUID,
    "promo_code_id" UUID,
    "subscription_ends_at" TIMESTAMP(3),
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_sale_units" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "default_base_quantity" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "barcode" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_sale_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_feature_entitlements" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "feature" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_feature_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_domains" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "hostname" VARCHAR(253) NOT NULL,
    "status" "CatalogDomainStatus" NOT NULL DEFAULT 'PENDING_DNS',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "redirect_to_primary" BOOLEAN NOT NULL DEFAULT true,
    "include_www" BOOLEAN NOT NULL DEFAULT false,
    "verification_token" VARCHAR(128) NOT NULL,
    "last_checked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_configs" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "about" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT '₽',
    "logo_media_id" UUID,
    "bg_media_id" UUID,
    "status" "CatalogStatus" NOT NULL DEFAULT 'PROPOSAL',
    "note" TEXT,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_contacts" (
    "id" UUID NOT NULL,
    "type" "ContactType" NOT NULL,
    "position" INTEGER NOT NULL,
    "value" TEXT NOT NULL,
    "catalog_id" UUID NOT NULL,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_settings" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "presentation_mode" "CatalogPresentationMode" NOT NULL DEFAULT 'CATALOG',
    "default_mode" "CatalogExperienceMode" NOT NULL DEFAULT 'DELIVERY',
    "allowed_modes" "CatalogExperienceMode"[] DEFAULT ARRAY['DELIVERY']::"CatalogExperienceMode"[],
    "inventory_mode" "CatalogInventoryMode" NOT NULL DEFAULT 'NONE',
    "address" TEXT,
    "checkout" JSONB,
    "google_verification" TEXT,
    "yandex_verification" TEXT,
    "active_price_list_id" UUID,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "name" VARCHAR(255) NOT NULL,
    "image_media_id" UUID,
    "descriptor" TEXT,
    "discount" INTEGER,
    "catalog_id" UUID NOT NULL,
    "parent_id" UUID,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_products" (
    "category_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "category_products_pkey" PRIMARY KEY ("category_id","product_id")
);

-- CreateTable
CREATE TABLE "domain_event_outbox" (
    "id" UUID NOT NULL,
    "event_id" VARCHAR(100) NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "aggregate_type" VARCHAR(80),
    "aggregate_id" VARCHAR(191),
    "catalog_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DomainEventOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "locked_at" TIMESTAMP(3),
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "metadata" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sync_started_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_sync_status" "IntegrationSyncStatus" NOT NULL DEFAULT 'IDLE',
    "last_sync_error" TEXT,
    "total_products" INTEGER NOT NULL DEFAULT 0,
    "created_products" INTEGER NOT NULL DEFAULT 0,
    "updated_products" INTEGER NOT NULL DEFAULT 0,
    "deleted_products" INTEGER NOT NULL DEFAULT 0,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_external_objects" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "code" VARCHAR(191) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "kind" "IntegrationExternalObjectKind" NOT NULL DEFAULT 'CUSTOM',
    "endpoint" VARCHAR(1000),
    "method" VARCHAR(16),
    "schema" JSONB,
    "sample" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_discovered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_external_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_entity_mappings" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "external_object_id" UUID,
    "localEntity" "IntegrationMappingLocalEntity" NOT NULL,
    "external_object_code" VARCHAR(191) NOT NULL,
    "identity_field" VARCHAR(255) NOT NULL,
    "direction" "IntegrationMappingDirection" NOT NULL DEFAULT 'IMPORT',
    "conflict_policy" VARCHAR(64),
    "filters" JSONB,
    "options" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_entity_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_field_mappings" (
    "id" UUID NOT NULL,
    "entity_mapping_id" UUID NOT NULL,
    "local_path" VARCHAR(255) NOT NULL,
    "external_path" VARCHAR(500) NOT NULL,
    "direction" "IntegrationMappingDirection" NOT NULL DEFAULT 'IMPORT',
    "data_type" "IntegrationMappingDataType" NOT NULL DEFAULT 'STRING',
    "transform" JSONB,
    "default_value" JSONB,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_field_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_external_items" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "external_id" VARCHAR(128) NOT NULL,
    "external_parent_id" VARCHAR(128),
    "public_code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255),
    "code" VARCHAR(128),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "raw_meta" JSONB,
    "last_seen_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_external_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_product_links" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "external_id" VARCHAR(128) NOT NULL,
    "external_code" VARCHAR(100),
    "external_updated_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "last_price_sync_at" TIMESTAMP(3),
    "last_stock_sync_at" TIMESTAMP(3),
    "missing_since" TIMESTAMP(3),
    "missing_sync_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_reason" VARCHAR(191),
    "last_external_error" TEXT,
    "raw_meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_product_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_variant_links" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "external_id" VARCHAR(128) NOT NULL,
    "external_code" VARCHAR(100),
    "external_updated_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "last_price_sync_at" TIMESTAMP(3),
    "last_stock_sync_at" TIMESTAMP(3),
    "missing_since" TIMESTAMP(3),
    "missing_sync_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_reason" VARCHAR(191),
    "last_external_error" TEXT,
    "raw_meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_variant_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_category_links" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "external_id" VARCHAR(64) NOT NULL,
    "external_parent_id" VARCHAR(64),
    "raw_meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_category_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_runs" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "mode" "IntegrationSyncRunMode" NOT NULL,
    "trigger" "IntegrationSyncRunTrigger" NOT NULL,
    "status" "IntegrationSyncRunStatus" NOT NULL DEFAULT 'PENDING',
    "snapshot_completeness" "IntegrationSyncSnapshotCompleteness" NOT NULL DEFAULT 'PARTIAL',
    "job_id" VARCHAR(191),
    "product_id" UUID,
    "external_id" VARCHAR(64),
    "error" TEXT,
    "metadata" JSONB,
    "total_products" INTEGER NOT NULL DEFAULT 0,
    "created_products" INTEGER NOT NULL DEFAULT 0,
    "updated_products" INTEGER NOT NULL DEFAULT 0,
    "deleted_products" INTEGER NOT NULL DEFAULT 0,
    "images_imported" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_order_exports" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "idempotency_key" VARCHAR(191) NOT NULL,
    "external_id" VARCHAR(64),
    "status" "IntegrationOrderExportStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "payload" JSONB,
    "response" JSONB,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "exported_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_order_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_webhook_events" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "request_id" VARCHAR(191) NOT NULL,
    "report_url" VARCHAR(1000) NOT NULL,
    "payload" JSONB,
    "status" "IntegrationWebhookEventStatus" NOT NULL DEFAULT 'PENDING',
    "job_id" VARCHAR(191),
    "error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_warehouses" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "status" "InventoryWarehouseStatus" NOT NULL DEFAULT 'ACTIVE',
    "address" VARCHAR(500),
    "metadata" JSONB,
    "owner_user_id" UUID,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_warehouse_catalogs" (
    "warehouse_id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_warehouse_catalogs_pkey" PRIMARY KEY ("warehouse_id","catalog_id")
);

-- CreateTable
CREATE TABLE "inventory_stock_balances" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "quantity_reserved" INTEGER NOT NULL DEFAULT 0,
    "quantity_available" INTEGER NOT NULL DEFAULT 0,
    "last_movement_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID,
    "type" "InventoryMovementType" NOT NULL,
    "source" "InventoryMovementSource" NOT NULL DEFAULT 'SYSTEM',
    "quantity_delta" INTEGER NOT NULL,
    "quantity_after" INTEGER,
    "reservation_id" UUID,
    "order_id" UUID,
    "cart_id" UUID,
    "integration_id" UUID,
    "actor_user_id" UUID,
    "idempotency_key" VARCHAR(191),
    "external_document_id" VARCHAR(191),
    "reason" VARCHAR(255),
    "metadata" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "InventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "cart_id" UUID,
    "cart_item_id" UUID,
    "order_id" UUID,
    "expires_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "idempotency_key" VARCHAR(191),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "catalog_id" UUID NOT NULL,
    "path" VARCHAR(255),
    "entity_id" VARCHAR(255),
    "storage" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "checksum" TEXT,
    "status" "MediaStatus" NOT NULL DEFAULT 'UPLOADED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_variants" (
    "id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "mime_type" TEXT,
    "size" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "storage" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics" (
    "id" UUID NOT NULL,
    "provider" "Metric" NOT NULL DEFAULT 'YANDEX',
    "scope" "MetricScope" NOT NULL DEFAULT 'CATALOG',
    "counter_id" TEXT NOT NULL,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_runs" (
    "id" UUID NOT NULL,
    "source" VARCHAR(100) NOT NULL DEFAULT 'old-code',
    "phase" VARCHAR(100) NOT NULL,
    "status" "MigrationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "dry_run" BOOLEAN NOT NULL DEFAULT true,
    "options" JSONB,
    "summary" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "migration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_entity_maps" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "source" VARCHAR(100) NOT NULL DEFAULT 'old-code',
    "entity" "MigrationEntityKind" NOT NULL,
    "legacy_id" VARCHAR(191) NOT NULL,
    "target_id" VARCHAR(191) NOT NULL,
    "legacy_parent_id" VARCHAR(191),
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "migration_entity_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_issues" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "source" VARCHAR(100) NOT NULL DEFAULT 'old-code',
    "entity" "MigrationEntityKind",
    "legacy_id" VARCHAR(191),
    "severity" "MigrationIssueSeverity" NOT NULL DEFAULT 'ERROR',
    "code" VARCHAR(100) NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_modifier_groups" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" VARCHAR(1000),
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "min_selected" INTEGER NOT NULL DEFAULT 0,
    "max_selected" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "raw_meta" JSONB,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_modifier_options" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" VARCHAR(1000),
    "default_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "raw_meta" JSONB,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_modifier_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_modifier_group_options" (
    "group_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "default_price" DECIMAL(12,2),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_modifier_group_options_pkey" PRIMARY KEY ("group_id","option_id")
);

-- CreateTable
CREATE TABLE "product_type_modifier_group_templates" (
    "id" UUID NOT NULL,
    "product_type_id" UUID NOT NULL,
    "catalog_modifier_group_id" UUID,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" VARCHAR(1000),
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "min_selected" INTEGER NOT NULL DEFAULT 0,
    "max_selected" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_type_modifier_group_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_type_modifier_option_templates" (
    "id" UUID NOT NULL,
    "template_group_id" UUID NOT NULL,
    "catalog_modifier_option_id" UUID,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "price" DECIMAL(12,2),
    "max_quantity" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_type_modifier_option_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_modifier_groups" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "catalog_modifier_group_id" UUID,
    "scope" "ProductModifierScope" NOT NULL DEFAULT 'PRODUCT',
    "scope_key" VARCHAR(64) NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" VARCHAR(1000),
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "min_selected" INTEGER NOT NULL DEFAULT 0,
    "max_selected" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "raw_meta" JSONB,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_modifier_options" (
    "id" UUID NOT NULL,
    "product_modifier_group_id" UUID NOT NULL,
    "catalog_modifier_option_id" UUID,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "max_quantity" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "raw_meta" JSONB,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_modifier_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_item_modifiers" (
    "id" UUID NOT NULL,
    "cart_item_id" UUID NOT NULL,
    "product_modifier_group_id" UUID,
    "product_modifier_option_id" UUID,
    "catalog_modifier_group_id" UUID,
    "catalog_modifier_option_id" UUID,
    "group_code" VARCHAR(100) NOT NULL,
    "group_name" VARCHAR(255) NOT NULL,
    "option_code" VARCHAR(100) NOT NULL,
    "option_name" VARCHAR(255) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_snapshot" DECIMAL(12,2) NOT NULL,
    "raw_meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_item_modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_modifier_group_links" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "catalog_modifier_group_id" UUID,
    "product_modifier_group_id" UUID,
    "external_id" VARCHAR(128) NOT NULL,
    "external_code" VARCHAR(100),
    "raw_meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_modifier_group_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_modifier_option_links" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "catalog_modifier_option_id" UUID,
    "product_modifier_option_id" UUID,
    "external_id" VARCHAR(128) NOT NULL,
    "external_code" VARCHAR(100),
    "raw_meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_modifier_option_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "legacy_order_id" VARCHAR(191),
    "legacy_user_id" VARCHAR(191),
    "token" TEXT,
    "comment" TEXT,
    "address" TEXT,
    "is_delivery" BOOLEAN NOT NULL DEFAULT false,
    "checkout_method" "CartCheckoutMethod",
    "checkout_data" JSONB,
    "checkout_contacts" JSONB,
    "comment_by_admin" TEXT,
    "payment_method" "PaymentMethod",
    "payment_proof" TEXT[],
    "products" JSONB NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "catalog_id" UUID NOT NULL,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'SUBSCRIPTION',
    "catalog_id" UUID NOT NULL,
    "promo_code_id" UUID,
    "paid_at" TIMESTAMP(3),
    "amount" DECIMAL(12,2),
    "license_ends_at" TIMESTAMP(3),
    "proof_url" TEXT,
    "metadata" JSONB,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_price_lists" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" VARCHAR(1000),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_price_list_prices" (
    "id" UUID NOT NULL,
    "price_list_id" UUID NOT NULL,
    "target" "CatalogPriceListPriceTarget" NOT NULL,
    "target_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "sale_unit_id" UUID,
    "price" DECIMAL(12,2) NOT NULL,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_price_list_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_types" (
    "id" UUID NOT NULL,
    "catalog_id" UUID,
    "scope" "ProductTypeScope" NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" VARCHAR(1000),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_type_attributes" (
    "product_type_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "is_variant" BOOLEAN NOT NULL DEFAULT false,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_type_attributes_pkey" PRIMARY KEY ("product_type_id","attribute_id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "brand_id" UUID,
    "product_type_id" UUID,
    "sku" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "price" DECIMAL(12,2),
    "is_popular" BOOLEAN NOT NULL DEFAULT false,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "position" INTEGER NOT NULL DEFAULT 0,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attributes" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "enum_value_id" UUID,
    "value_string" TEXT,
    "value_integer" INTEGER,
    "value_decimal" DECIMAL(12,4),
    "value_boolean" BOOLEAN,
    "value_datetime" TIMESTAMP(3),
    "delete_at" TIMESTAMP(3),

    CONSTRAINT "product_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "variant_key" VARCHAR(300) NOT NULL,
    "kind" "ProductVariantKind" NOT NULL DEFAULT 'MATRIX',
    "stock" INTEGER,
    "price" DECIMAL(12,2),
    "status" "ProductVariantStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant_sale_units" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "catalog_sale_unit_id" UUID,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "base_quantity" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "price" DECIMAL(12,2) NOT NULL,
    "barcode" VARCHAR(100),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variant_sale_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_media" (
    "product_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "kind" VARCHAR(50),

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("product_id","media_id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "sur_name" TEXT NOT NULL,
    "bet" TEXT NOT NULL,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "id" UUID NOT NULL,
    "code" VARCHAR(8) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regionality" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country_id" UUID,
    "parent_id" UUID,
    "country_code" VARCHAR(8) NOT NULL DEFAULT 'RU',
    "country_name" VARCHAR(100) NOT NULL DEFAULT 'Россия',
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regionality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "s3" (
    "id" UUID NOT NULL,
    "name" VARCHAR NOT NULL,
    "access_key" VARCHAR NOT NULL,
    "secret_access_key" VARCHAR NOT NULL,
    "region" VARCHAR NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "s3_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_settings" (
    "id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "entity_type" "SeoEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "url_path" VARCHAR(1024),
    "canonical_url" VARCHAR(2048),
    "title" VARCHAR(255),
    "description" VARCHAR(500),
    "keywords" VARCHAR(500),
    "h1" VARCHAR(255),
    "seoText" TEXT,
    "robots" VARCHAR(100),
    "is_indexable" BOOLEAN NOT NULL DEFAULT true,
    "is_followable" BOOLEAN NOT NULL DEFAULT true,
    "og_title" VARCHAR(255),
    "og_description" VARCHAR(500),
    "og_media_id" UUID,
    "og_type" VARCHAR(100),
    "og_url" VARCHAR(2048),
    "og_site_name" VARCHAR(255),
    "og_locale" VARCHAR(20),
    "twitter_card" VARCHAR(50),
    "twitter_title" VARCHAR(255),
    "twitter_description" VARCHAR(500),
    "twitter_media_id" UUID,
    "favicon_media_id" UUID,
    "twitter_site" VARCHAR(100),
    "twitter_creator" VARCHAR(100),
    "hreflang" JSONB,
    "structured_data" JSONB,
    "extras" JSONB,
    "sitemap_priority" DECIMAL(3,2),
    "sitemap_changefreq" "SeoChangeFreq",
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "types" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "role" "Role" NOT NULL,
    "isEmailConfirmed" BOOLEAN NOT NULL,
    "delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ActivityToType" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_ActivityToType_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ActivityToCatalog" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_ActivityToCatalog_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_AttributeToType" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_AttributeToType_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_CatalogToRegionality" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_CatalogToRegionality_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_CatalogToMetrics" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_CatalogToMetrics_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_CountryToUser" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_CountryToUser_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_RegionalityToUser" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_RegionalityToUser_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "analytics_sessions_catalog_id_started_at_idx" ON "analytics_sessions"("catalog_id", "started_at");

-- CreateIndex
CREATE INDEX "analytics_sessions_metrika_client_id_idx" ON "analytics_sessions"("metrika_client_id");

-- CreateIndex
CREATE INDEX "analytics_sessions_token_idx" ON "analytics_sessions"("token");

-- CreateIndex
CREATE INDEX "analytics_events_catalog_id_created_at_idx" ON "analytics_events"("catalog_id", "created_at");

-- CreateIndex
CREATE INDEX "analytics_events_session_id_created_at_idx" ON "analytics_events"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "analytics_events_type_created_at_idx" ON "analytics_events"("type", "created_at");

-- CreateIndex
CREATE INDEX "analytics_events_product_id_created_at_idx" ON "analytics_events"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "analytics_events_category_id_created_at_idx" ON "analytics_events"("category_id", "created_at");

-- CreateIndex
CREATE INDEX "analytics_events_variant_id_created_at_idx" ON "analytics_events"("variant_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_catalog_id_created_at_idx" ON "leads"("catalog_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_status_created_at_idx" ON "leads"("status", "created_at");

-- CreateIndex
CREATE INDEX "metrika_daily_stats_date_idx" ON "metrika_daily_stats"("date");

-- CreateIndex
CREATE UNIQUE INDEX "metrika_daily_stats_catalog_id_date_key" ON "metrika_daily_stats"("catalog_id", "date");

-- CreateIndex
CREATE INDEX "metrika_source_daily_stats_catalog_id_date_idx" ON "metrika_source_daily_stats"("catalog_id", "date");

-- CreateIndex
CREATE INDEX "attributes_key_idx" ON "attributes"("key");

-- CreateIndex
CREATE INDEX "attribute_enum_values_catalog_id_attribute_id_idx" ON "attribute_enum_values"("catalog_id", "attribute_id");

-- CreateIndex
CREATE INDEX "attribute_enum_values_attribute_id_source_idx" ON "attribute_enum_values"("attribute_id", "source");

-- CreateIndex
CREATE INDEX "attribute_enum_values_merged_into_id_idx" ON "attribute_enum_values"("merged_into_id");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_enum_values_attribute_id_catalog_id_value_key" ON "attribute_enum_values"("attribute_id", "catalog_id", "value");

-- CreateIndex
CREATE INDEX "attribute_enum_value_aliases_catalog_id_attribute_id_idx" ON "attribute_enum_value_aliases"("catalog_id", "attribute_id");

-- CreateIndex
CREATE INDEX "attribute_enum_value_aliases_enum_value_id_idx" ON "attribute_enum_value_aliases"("enum_value_id");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_enum_value_aliases_attribute_id_catalog_id_value_key" ON "attribute_enum_value_aliases"("attribute_id", "catalog_id", "value");

-- CreateIndex
CREATE INDEX "variant_attributes_attribute_id_enum_value_id_idx" ON "variant_attributes"("attribute_id", "enum_value_id");

-- CreateIndex
CREATE UNIQUE INDEX "variant_attributes_variant_id_attribute_id_key" ON "variant_attributes"("variant_id", "attribute_id");

-- CreateIndex
CREATE INDEX "audit_events_created_at_idx" ON "audit_events"("created_at");

-- CreateIndex
CREATE INDEX "audit_events_action_created_at_idx" ON "audit_events"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_category_created_at_idx" ON "audit_events"("category", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_outcome_created_at_idx" ON "audit_events"("outcome", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_severity_created_at_idx" ON "audit_events"("severity", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_type_created_at_idx" ON "audit_events"("actor_type", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_user_id_created_at_idx" ON "audit_events"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_created_at_idx" ON "audit_events"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_target_type_target_id_created_at_idx" ON "audit_events"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_target_catalog_id_created_at_idx" ON "audit_events"("target_catalog_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_request_id_idx" ON "audit_events"("request_id");

-- CreateIndex
CREATE INDEX "audit_events_correlation_id_idx" ON "audit_events"("correlation_id");

-- CreateIndex
CREATE INDEX "audit_event_targets_event_id_idx" ON "audit_event_targets"("event_id");

-- CreateIndex
CREATE INDEX "audit_event_targets_target_type_target_id_idx" ON "audit_event_targets"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_event_targets_catalog_id_created_at_idx" ON "audit_event_targets"("catalog_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_event_changes_event_id_idx" ON "audit_event_changes"("event_id");

-- CreateIndex
CREATE INDEX "audit_event_changes_field_idx" ON "audit_event_changes"("field");

-- CreateIndex
CREATE INDEX "brands_catalog_id_idx" ON "brands"("catalog_id");

-- CreateIndex
CREATE UNIQUE INDEX "brands_catalog_id_slug_key" ON "brands"("catalog_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "carts_public_key_key" ON "carts"("public_key");

-- CreateIndex
CREATE INDEX "carts_status_manager_last_seen_at_idx" ON "carts"("status", "manager_last_seen_at");

-- CreateIndex
CREATE INDEX "cart_items_cart_id_delete_at_idx" ON "cart_items"("cart_id", "delete_at");

-- CreateIndex
CREATE INDEX "cart_items_cart_id_guest_session_id_delete_at_idx" ON "cart_items"("cart_id", "guest_session_id", "delete_at");

-- CreateIndex
CREATE INDEX "cart_items_variant_id_idx" ON "cart_items"("variant_id");

-- CreateIndex
CREATE INDEX "cart_items_sale_unit_id_idx" ON "cart_items"("sale_unit_id");

-- CreateIndex
CREATE INDEX "cart_items_price_list_id_idx" ON "cart_items"("price_list_id");

-- CreateIndex
CREATE INDEX "cart_items_cart_id_product_id_variant_id_sale_unit_id_guest_idx" ON "cart_items"("cart_id", "product_id", "variant_id", "sale_unit_id", "guest_session_id", "modifier_signature");

-- CreateIndex
CREATE UNIQUE INDEX "cart_table_sessions_cart_id_key" ON "cart_table_sessions"("cart_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_table_sessions_active_key_key" ON "cart_table_sessions"("active_key");

-- CreateIndex
CREATE INDEX "cart_table_sessions_catalog_id_provider_table_external_id_s_idx" ON "cart_table_sessions"("catalog_id", "provider", "table_external_id", "status");

-- CreateIndex
CREATE INDEX "cart_table_sessions_integration_id_status_idx" ON "cart_table_sessions"("integration_id", "status");

-- CreateIndex
CREATE INDEX "cart_table_sessions_submitted_order_id_idx" ON "cart_table_sessions"("submitted_order_id");

-- CreateIndex
CREATE INDEX "cart_table_sessions_external_table_item_id_idx" ON "cart_table_sessions"("external_table_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_signups_token_hash_key" ON "catalog_signups"("token_hash");

-- CreateIndex
CREATE INDEX "catalog_signups_email_status_idx" ON "catalog_signups"("email", "status");

-- CreateIndex
CREATE INDEX "catalog_signups_slug_status_expires_at_idx" ON "catalog_signups"("slug", "status", "expires_at");

-- CreateIndex
CREATE INDEX "catalog_signups_type_id_idx" ON "catalog_signups"("type_id");

-- CreateIndex
CREATE INDEX "catalog_signups_created_user_id_idx" ON "catalog_signups"("created_user_id");

-- CreateIndex
CREATE INDEX "catalog_signups_created_catalog_id_idx" ON "catalog_signups"("created_catalog_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalogs_slug_key" ON "catalogs"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "catalogs_domain_key" ON "catalogs"("domain");

-- CreateIndex
CREATE INDEX "catalogs_type_id_idx" ON "catalogs"("type_id");

-- CreateIndex
CREATE INDEX "catalog_sale_units_catalog_id_is_active_display_order_idx" ON "catalog_sale_units"("catalog_id", "is_active", "display_order");

-- CreateIndex
CREATE INDEX "catalog_sale_units_catalog_id_delete_at_idx" ON "catalog_sale_units"("catalog_id", "delete_at");

-- CreateIndex
CREATE INDEX "catalog_sale_units_barcode_idx" ON "catalog_sale_units"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_sale_units_catalog_id_code_key" ON "catalog_sale_units"("catalog_id", "code");

-- CreateIndex
CREATE INDEX "catalog_feature_entitlements_feature_enabled_idx" ON "catalog_feature_entitlements"("feature", "enabled");

-- CreateIndex
CREATE INDEX "catalog_feature_entitlements_expires_at_idx" ON "catalog_feature_entitlements"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_feature_entitlements_catalog_id_feature_key" ON "catalog_feature_entitlements"("catalog_id", "feature");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_domains_hostname_key" ON "catalog_domains"("hostname");

-- CreateIndex
CREATE INDEX "catalog_domains_catalog_id_idx" ON "catalog_domains"("catalog_id");

-- CreateIndex
CREATE INDEX "catalog_domains_status_idx" ON "catalog_domains"("status");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_configs_catalog_id_key" ON "catalog_configs"("catalog_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_settings_catalog_id_key" ON "catalog_settings"("catalog_id");

-- CreateIndex
CREATE INDEX "catalog_settings_active_price_list_id_idx" ON "catalog_settings"("active_price_list_id");

-- CreateIndex
CREATE INDEX "categories_catalog_id_delete_at_position_name_idx" ON "categories"("catalog_id", "delete_at", "position", "name");

-- CreateIndex
CREATE INDEX "categories_parent_id_delete_at_position_name_idx" ON "categories"("parent_id", "delete_at", "position", "name");

-- CreateIndex
CREATE INDEX "category_products_category_id_position_product_id_idx" ON "category_products"("category_id", "position", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "domain_event_outbox_event_id_key" ON "domain_event_outbox"("event_id");

-- CreateIndex
CREATE INDEX "domain_event_outbox_status_occurred_at_idx" ON "domain_event_outbox"("status", "occurred_at");

-- CreateIndex
CREATE INDEX "domain_event_outbox_catalog_id_occurred_at_idx" ON "domain_event_outbox"("catalog_id", "occurred_at");

-- CreateIndex
CREATE INDEX "domain_event_outbox_event_type_occurred_at_idx" ON "domain_event_outbox"("event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "domain_event_outbox_aggregate_type_aggregate_id_occurred_at_idx" ON "domain_event_outbox"("aggregate_type", "aggregate_id", "occurred_at");

-- CreateIndex
CREATE INDEX "integrations_catalog_id_is_active_idx" ON "integrations"("catalog_id", "is_active");

-- CreateIndex
CREATE INDEX "integrations_last_sync_status_sync_started_at_idx" ON "integrations"("last_sync_status", "sync_started_at");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_catalog_id_provider_key" ON "integrations"("catalog_id", "provider");

-- CreateIndex
CREATE INDEX "integration_external_objects_integration_id_kind_is_active_idx" ON "integration_external_objects"("integration_id", "kind", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "integration_external_objects_integration_id_code_key" ON "integration_external_objects"("integration_id", "code");

-- CreateIndex
CREATE INDEX "integration_entity_mappings_integration_id_localEntity_is_a_idx" ON "integration_entity_mappings"("integration_id", "localEntity", "is_active");

-- CreateIndex
CREATE INDEX "integration_entity_mappings_external_object_id_idx" ON "integration_entity_mappings"("external_object_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_entity_mappings_integration_id_localEntity_exte_key" ON "integration_entity_mappings"("integration_id", "localEntity", "external_object_code");

-- CreateIndex
CREATE INDEX "integration_field_mappings_entity_mapping_id_is_active_disp_idx" ON "integration_field_mappings"("entity_mapping_id", "is_active", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "integration_field_mappings_entity_mapping_id_local_path_ext_key" ON "integration_field_mappings"("entity_mapping_id", "local_path", "external_path");

-- CreateIndex
CREATE UNIQUE INDEX "integration_external_items_public_code_key" ON "integration_external_items"("public_code");

-- CreateIndex
CREATE INDEX "integration_external_items_catalog_id_provider_type_idx" ON "integration_external_items"("catalog_id", "provider", "type");

-- CreateIndex
CREATE INDEX "integration_external_items_integration_id_type_external_par_idx" ON "integration_external_items"("integration_id", "type", "external_parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_external_items_integration_id_type_external_id_key" ON "integration_external_items"("integration_id", "type", "external_id");

-- CreateIndex
CREATE INDEX "integration_product_links_product_id_idx" ON "integration_product_links"("product_id");

-- CreateIndex
CREATE INDEX "integration_product_links_integration_id_missing_since_idx" ON "integration_product_links"("integration_id", "missing_since");

-- CreateIndex
CREATE UNIQUE INDEX "integration_product_links_integration_id_external_id_key" ON "integration_product_links"("integration_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_product_links_integration_id_product_id_key" ON "integration_product_links"("integration_id", "product_id");

-- CreateIndex
CREATE INDEX "integration_variant_links_variant_id_idx" ON "integration_variant_links"("variant_id");

-- CreateIndex
CREATE INDEX "integration_variant_links_integration_id_missing_since_idx" ON "integration_variant_links"("integration_id", "missing_since");

-- CreateIndex
CREATE UNIQUE INDEX "integration_variant_links_integration_id_external_id_key" ON "integration_variant_links"("integration_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_variant_links_integration_id_variant_id_key" ON "integration_variant_links"("integration_id", "variant_id");

-- CreateIndex
CREATE INDEX "integration_category_links_category_id_idx" ON "integration_category_links"("category_id");

-- CreateIndex
CREATE INDEX "integration_category_links_external_parent_id_idx" ON "integration_category_links"("external_parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_category_links_integration_id_external_id_key" ON "integration_category_links"("integration_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_category_links_integration_id_category_id_key" ON "integration_category_links"("integration_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_sync_runs_job_id_key" ON "integration_sync_runs"("job_id");

-- CreateIndex
CREATE INDEX "integration_sync_runs_integration_id_requested_at_idx" ON "integration_sync_runs"("integration_id", "requested_at");

-- CreateIndex
CREATE INDEX "integration_sync_runs_catalog_id_provider_requested_at_idx" ON "integration_sync_runs"("catalog_id", "provider", "requested_at");

-- CreateIndex
CREATE INDEX "integration_sync_runs_status_requested_at_idx" ON "integration_sync_runs"("status", "requested_at");

-- CreateIndex
CREATE INDEX "integration_sync_runs_product_id_requested_at_idx" ON "integration_sync_runs"("product_id", "requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_order_exports_idempotency_key_key" ON "integration_order_exports"("idempotency_key");

-- CreateIndex
CREATE INDEX "integration_order_exports_order_id_idx" ON "integration_order_exports"("order_id");

-- CreateIndex
CREATE INDEX "integration_order_exports_status_requested_at_idx" ON "integration_order_exports"("status", "requested_at");

-- CreateIndex
CREATE INDEX "integration_order_exports_integration_id_status_requested_a_idx" ON "integration_order_exports"("integration_id", "status", "requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_order_exports_integration_id_order_id_key" ON "integration_order_exports"("integration_id", "order_id");

-- CreateIndex
CREATE INDEX "integration_webhook_events_integration_id_status_received_a_idx" ON "integration_webhook_events"("integration_id", "status", "received_at");

-- CreateIndex
CREATE INDEX "integration_webhook_events_provider_status_received_at_idx" ON "integration_webhook_events"("provider", "status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_webhook_events_integration_id_request_id_key" ON "integration_webhook_events"("integration_id", "request_id");

-- CreateIndex
CREATE INDEX "inventory_warehouses_owner_user_id_status_idx" ON "inventory_warehouses"("owner_user_id", "status");

-- CreateIndex
CREATE INDEX "inventory_warehouses_code_idx" ON "inventory_warehouses"("code");

-- CreateIndex
CREATE INDEX "inventory_warehouses_status_idx" ON "inventory_warehouses"("status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_warehouses_owner_user_id_code_key" ON "inventory_warehouses"("owner_user_id", "code");

-- CreateIndex
CREATE INDEX "inventory_warehouse_catalogs_catalog_id_is_default_idx" ON "inventory_warehouse_catalogs"("catalog_id", "is_default");

-- CreateIndex
CREATE INDEX "inventory_stock_balances_variant_id_idx" ON "inventory_stock_balances"("variant_id");

-- CreateIndex
CREATE INDEX "inventory_stock_balances_warehouse_id_idx" ON "inventory_stock_balances"("warehouse_id");

-- CreateIndex
CREATE INDEX "inventory_stock_balances_warehouse_id_quantity_on_hand_idx" ON "inventory_stock_balances"("warehouse_id", "quantity_on_hand");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_stock_balances_warehouse_id_variant_id_key" ON "inventory_stock_balances"("warehouse_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_idempotency_key_key" ON "inventory_movements"("idempotency_key");

-- CreateIndex
CREATE INDEX "inventory_movements_warehouse_id_occurred_at_idx" ON "inventory_movements"("warehouse_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_movements_variant_id_occurred_at_idx" ON "inventory_movements"("variant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_movements_type_occurred_at_idx" ON "inventory_movements"("type", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_movements_order_id_idx" ON "inventory_movements"("order_id");

-- CreateIndex
CREATE INDEX "inventory_movements_cart_id_idx" ON "inventory_movements"("cart_id");

-- CreateIndex
CREATE INDEX "inventory_movements_actor_user_id_idx" ON "inventory_movements"("actor_user_id");

-- CreateIndex
CREATE INDEX "inventory_movements_integration_id_external_document_id_idx" ON "inventory_movements"("integration_id", "external_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_reservations_idempotency_key_key" ON "inventory_reservations"("idempotency_key");

-- CreateIndex
CREATE INDEX "inventory_reservations_warehouse_id_status_idx" ON "inventory_reservations"("warehouse_id", "status");

-- CreateIndex
CREATE INDEX "inventory_reservations_variant_id_status_idx" ON "inventory_reservations"("variant_id", "status");

-- CreateIndex
CREATE INDEX "inventory_reservations_cart_id_status_idx" ON "inventory_reservations"("cart_id", "status");

-- CreateIndex
CREATE INDEX "inventory_reservations_cart_item_id_idx" ON "inventory_reservations"("cart_item_id");

-- CreateIndex
CREATE INDEX "inventory_reservations_order_id_idx" ON "inventory_reservations"("order_id");

-- CreateIndex
CREATE INDEX "inventory_reservations_status_expires_at_idx" ON "inventory_reservations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "media_catalog_id_idx" ON "media"("catalog_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_catalog_id_key_key" ON "media"("catalog_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "media_variants_media_id_kind_key" ON "media_variants"("media_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "metrics_counter_id_key" ON "metrics"("counter_id");

-- CreateIndex
CREATE INDEX "migration_runs_source_phase_started_at_idx" ON "migration_runs"("source", "phase", "started_at");

-- CreateIndex
CREATE INDEX "migration_entity_maps_entity_target_id_idx" ON "migration_entity_maps"("entity", "target_id");

-- CreateIndex
CREATE INDEX "migration_entity_maps_run_id_entity_idx" ON "migration_entity_maps"("run_id", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "migration_entity_maps_source_entity_legacy_id_key" ON "migration_entity_maps"("source", "entity", "legacy_id");

-- CreateIndex
CREATE INDEX "migration_issues_run_id_severity_idx" ON "migration_issues"("run_id", "severity");

-- CreateIndex
CREATE INDEX "migration_issues_source_entity_legacy_id_idx" ON "migration_issues"("source", "entity", "legacy_id");

-- CreateIndex
CREATE INDEX "catalog_modifier_groups_catalog_id_is_active_display_order_idx" ON "catalog_modifier_groups"("catalog_id", "is_active", "display_order");

-- CreateIndex
CREATE INDEX "catalog_modifier_groups_catalog_id_delete_at_idx" ON "catalog_modifier_groups"("catalog_id", "delete_at");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_modifier_groups_catalog_id_code_key" ON "catalog_modifier_groups"("catalog_id", "code");

-- CreateIndex
CREATE INDEX "catalog_modifier_options_catalog_id_is_active_display_order_idx" ON "catalog_modifier_options"("catalog_id", "is_active", "display_order");

-- CreateIndex
CREATE INDEX "catalog_modifier_options_catalog_id_delete_at_idx" ON "catalog_modifier_options"("catalog_id", "delete_at");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_modifier_options_catalog_id_code_key" ON "catalog_modifier_options"("catalog_id", "code");

-- CreateIndex
CREATE INDEX "catalog_modifier_group_options_option_id_idx" ON "catalog_modifier_group_options"("option_id");

-- CreateIndex
CREATE INDEX "catalog_modifier_group_options_group_id_is_active_display_o_idx" ON "catalog_modifier_group_options"("group_id", "is_active", "display_order");

-- CreateIndex
CREATE INDEX "product_type_modifier_group_templates_catalog_modifier_grou_idx" ON "product_type_modifier_group_templates"("catalog_modifier_group_id");

-- CreateIndex
CREATE INDEX "product_type_modifier_group_templates_product_type_id_is_ac_idx" ON "product_type_modifier_group_templates"("product_type_id", "is_active", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "product_type_modifier_group_templates_product_type_id_code_key" ON "product_type_modifier_group_templates"("product_type_id", "code");

-- CreateIndex
CREATE INDEX "product_type_modifier_option_templates_catalog_modifier_opt_idx" ON "product_type_modifier_option_templates"("catalog_modifier_option_id");

-- CreateIndex
CREATE INDEX "product_type_modifier_option_templates_template_group_id_is_idx" ON "product_type_modifier_option_templates"("template_group_id", "is_available", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "product_type_modifier_option_templates_template_group_id_co_key" ON "product_type_modifier_option_templates"("template_group_id", "code");

-- CreateIndex
CREATE INDEX "product_modifier_groups_product_id_is_active_display_order_idx" ON "product_modifier_groups"("product_id", "is_active", "display_order");

-- CreateIndex
CREATE INDEX "product_modifier_groups_variant_id_idx" ON "product_modifier_groups"("variant_id");

-- CreateIndex
CREATE INDEX "product_modifier_groups_catalog_modifier_group_id_idx" ON "product_modifier_groups"("catalog_modifier_group_id");

-- CreateIndex
CREATE INDEX "product_modifier_groups_product_id_variant_id_delete_at_idx" ON "product_modifier_groups"("product_id", "variant_id", "delete_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_modifier_groups_product_id_scope_key_code_key" ON "product_modifier_groups"("product_id", "scope_key", "code");

-- CreateIndex
CREATE INDEX "product_modifier_options_catalog_modifier_option_id_idx" ON "product_modifier_options"("catalog_modifier_option_id");

-- CreateIndex
CREATE INDEX "product_modifier_options_product_modifier_group_id_is_avail_idx" ON "product_modifier_options"("product_modifier_group_id", "is_available", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "product_modifier_options_product_modifier_group_id_code_key" ON "product_modifier_options"("product_modifier_group_id", "code");

-- CreateIndex
CREATE INDEX "cart_item_modifiers_cart_item_id_idx" ON "cart_item_modifiers"("cart_item_id");

-- CreateIndex
CREATE INDEX "cart_item_modifiers_product_modifier_group_id_idx" ON "cart_item_modifiers"("product_modifier_group_id");

-- CreateIndex
CREATE INDEX "cart_item_modifiers_product_modifier_option_id_idx" ON "cart_item_modifiers"("product_modifier_option_id");

-- CreateIndex
CREATE INDEX "cart_item_modifiers_catalog_modifier_group_id_idx" ON "cart_item_modifiers"("catalog_modifier_group_id");

-- CreateIndex
CREATE INDEX "cart_item_modifiers_catalog_modifier_option_id_idx" ON "cart_item_modifiers"("catalog_modifier_option_id");

-- CreateIndex
CREATE INDEX "integration_modifier_group_links_catalog_modifier_group_id_idx" ON "integration_modifier_group_links"("catalog_modifier_group_id");

-- CreateIndex
CREATE INDEX "integration_modifier_group_links_product_modifier_group_id_idx" ON "integration_modifier_group_links"("product_modifier_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_modifier_group_links_integration_id_external_id_key" ON "integration_modifier_group_links"("integration_id", "external_id");

-- CreateIndex
CREATE INDEX "integration_modifier_option_links_catalog_modifier_option_i_idx" ON "integration_modifier_option_links"("catalog_modifier_option_id");

-- CreateIndex
CREATE INDEX "integration_modifier_option_links_product_modifier_option_i_idx" ON "integration_modifier_option_links"("product_modifier_option_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_modifier_option_links_integration_id_external_i_key" ON "integration_modifier_option_links"("integration_id", "external_id");

-- CreateIndex
CREATE INDEX "orders_catalog_id_created_at_idx" ON "orders"("catalog_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_catalog_id_legacy_order_id_idx" ON "orders"("catalog_id", "legacy_order_id");

-- CreateIndex
CREATE INDEX "payments_catalog_id_kind_created_at_idx" ON "payments"("catalog_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "payments_promo_code_id_idx" ON "payments"("promo_code_id");

-- CreateIndex
CREATE INDEX "catalog_price_lists_catalog_id_is_active_display_order_idx" ON "catalog_price_lists"("catalog_id", "is_active", "display_order");

-- CreateIndex
CREATE INDEX "catalog_price_lists_catalog_id_delete_at_idx" ON "catalog_price_lists"("catalog_id", "delete_at");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_price_lists_catalog_id_code_key" ON "catalog_price_lists"("catalog_id", "code");

-- CreateIndex
CREATE INDEX "catalog_price_list_prices_price_list_id_product_id_idx" ON "catalog_price_list_prices"("price_list_id", "product_id");

-- CreateIndex
CREATE INDEX "catalog_price_list_prices_price_list_id_variant_id_idx" ON "catalog_price_list_prices"("price_list_id", "variant_id");

-- CreateIndex
CREATE INDEX "catalog_price_list_prices_price_list_id_sale_unit_id_idx" ON "catalog_price_list_prices"("price_list_id", "sale_unit_id");

-- CreateIndex
CREATE INDEX "catalog_price_list_prices_product_id_idx" ON "catalog_price_list_prices"("product_id");

-- CreateIndex
CREATE INDEX "catalog_price_list_prices_variant_id_idx" ON "catalog_price_list_prices"("variant_id");

-- CreateIndex
CREATE INDEX "catalog_price_list_prices_sale_unit_id_idx" ON "catalog_price_list_prices"("sale_unit_id");

-- CreateIndex
CREATE INDEX "catalog_price_list_prices_delete_at_idx" ON "catalog_price_list_prices"("delete_at");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_price_list_prices_price_list_id_target_target_id_key" ON "catalog_price_list_prices"("price_list_id", "target", "target_id");

-- CreateIndex
CREATE INDEX "product_types_scope_code_idx" ON "product_types"("scope", "code");

-- CreateIndex
CREATE INDEX "product_types_catalog_id_is_active_is_archived_idx" ON "product_types"("catalog_id", "is_active", "is_archived");

-- CreateIndex
CREATE UNIQUE INDEX "product_types_catalog_id_code_key" ON "product_types"("catalog_id", "code");

-- CreateIndex
CREATE INDEX "product_type_attributes_attribute_id_idx" ON "product_type_attributes"("attribute_id");

-- CreateIndex
CREATE INDEX "product_type_attributes_product_type_id_display_order_idx" ON "product_type_attributes"("product_type_id", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_catalog_id_status_idx" ON "products"("catalog_id", "status");

-- CreateIndex
CREATE INDEX "products_catalog_id_idx" ON "products"("catalog_id");

-- CreateIndex
CREATE INDEX "products_catalog_id_delete_at_created_at_idx" ON "products"("catalog_id", "delete_at", "created_at");

-- CreateIndex
CREATE INDEX "products_catalog_id_delete_at_updated_at_id_idx" ON "products"("catalog_id", "delete_at", "updated_at", "id");

-- CreateIndex
CREATE INDEX "products_catalog_id_is_popular_delete_at_updated_at_idx" ON "products"("catalog_id", "is_popular", "delete_at", "updated_at");

-- CreateIndex
CREATE INDEX "products_brand_id_idx" ON "products"("brand_id");

-- CreateIndex
CREATE INDEX "products_catalog_id_product_type_id_idx" ON "products"("catalog_id", "product_type_id");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE INDEX "products_slug_idx" ON "products"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_catalog_id_sku_key" ON "products"("catalog_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_catalog_id_slug_key" ON "products"("catalog_id", "slug");

-- CreateIndex
CREATE INDEX "product_attributes_attribute_id_enum_value_id_idx" ON "product_attributes"("attribute_id", "enum_value_id");

-- CreateIndex
CREATE INDEX "product_attributes_attribute_id_value_integer_idx" ON "product_attributes"("attribute_id", "value_integer");

-- CreateIndex
CREATE INDEX "product_attributes_attribute_id_value_decimal_idx" ON "product_attributes"("attribute_id", "value_decimal");

-- CreateIndex
CREATE INDEX "product_attributes_attribute_id_idx" ON "product_attributes"("attribute_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_attributes_product_id_attribute_id_key" ON "product_attributes"("product_id", "attribute_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE INDEX "product_variants_is_available_idx" ON "product_variants"("is_available");

-- CreateIndex
CREATE INDEX "product_variants_status_idx" ON "product_variants"("status");

-- CreateIndex
CREATE INDEX "product_variants_product_id_kind_idx" ON "product_variants"("product_id", "kind");

-- CreateIndex
CREATE INDEX "product_variant_sale_units_variant_id_is_default_idx" ON "product_variant_sale_units"("variant_id", "is_default");

-- CreateIndex
CREATE INDEX "product_variant_sale_units_variant_id_is_active_display_ord_idx" ON "product_variant_sale_units"("variant_id", "is_active", "display_order");

-- CreateIndex
CREATE INDEX "product_variant_sale_units_catalog_sale_unit_id_idx" ON "product_variant_sale_units"("catalog_sale_unit_id");

-- CreateIndex
CREATE INDEX "product_variant_sale_units_barcode_idx" ON "product_variant_sale_units"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "product_variant_sale_units_variant_id_code_key" ON "product_variant_sale_units"("variant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "product_variant_sale_units_variant_id_catalog_sale_unit_id_key" ON "product_variant_sale_units"("variant_id", "catalog_sale_unit_id");

-- CreateIndex
CREATE INDEX "product_media_product_id_position_media_id_idx" ON "product_media"("product_id", "position", "media_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_name_key" ON "promo_codes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "countries_code_key" ON "countries"("code");

-- CreateIndex
CREATE UNIQUE INDEX "regionality_code_key" ON "regionality"("code");

-- CreateIndex
CREATE INDEX "regionality_country_id_idx" ON "regionality"("country_id");

-- CreateIndex
CREATE INDEX "regionality_parent_id_idx" ON "regionality"("parent_id");

-- CreateIndex
CREATE INDEX "regionality_country_code_idx" ON "regionality"("country_code");

-- CreateIndex
CREATE UNIQUE INDEX "s3_name_key" ON "s3"("name");

-- CreateIndex
CREATE UNIQUE INDEX "s3_access_key_key" ON "s3"("access_key");

-- CreateIndex
CREATE UNIQUE INDEX "s3_secret_access_key_key" ON "s3"("secret_access_key");

-- CreateIndex
CREATE INDEX "seo_settings_catalog_id_entity_type_idx" ON "seo_settings"("catalog_id", "entity_type");

-- CreateIndex
CREATE UNIQUE INDEX "seo_settings_catalog_id_entity_type_entity_id_key" ON "seo_settings"("catalog_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "types_code_key" ON "types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_login_role_key" ON "users"("login", "role");

-- CreateIndex
CREATE INDEX "_ActivityToType_B_index" ON "_ActivityToType"("B");

-- CreateIndex
CREATE INDEX "_ActivityToCatalog_B_index" ON "_ActivityToCatalog"("B");

-- CreateIndex
CREATE INDEX "_AttributeToType_B_index" ON "_AttributeToType"("B");

-- CreateIndex
CREATE INDEX "_CatalogToRegionality_B_index" ON "_CatalogToRegionality"("B");

-- CreateIndex
CREATE INDEX "_CatalogToMetrics_B_index" ON "_CatalogToMetrics"("B");

-- CreateIndex
CREATE INDEX "_CountryToUser_B_index" ON "_CountryToUser"("B");

-- CreateIndex
CREATE INDEX "_RegionalityToUser_B_index" ON "_RegionalityToUser"("B");

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "analytics_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "analytics_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_enum_values" ADD CONSTRAINT "attribute_enum_values_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_enum_values" ADD CONSTRAINT "attribute_enum_values_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_enum_values" ADD CONSTRAINT "attribute_enum_values_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "attribute_enum_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_enum_value_aliases" ADD CONSTRAINT "attribute_enum_value_aliases_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_enum_value_aliases" ADD CONSTRAINT "attribute_enum_value_aliases_enum_value_id_fkey" FOREIGN KEY ("enum_value_id") REFERENCES "attribute_enum_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_enum_value_aliases" ADD CONSTRAINT "attribute_enum_value_aliases_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attributes" ADD CONSTRAINT "variant_attributes_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attributes" ADD CONSTRAINT "variant_attributes_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "attributes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attributes" ADD CONSTRAINT "variant_attributes_enum_value_id_fkey" FOREIGN KEY ("enum_value_id") REFERENCES "attribute_enum_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event_targets" ADD CONSTRAINT "audit_event_targets_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "audit_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event_changes" ADD CONSTRAINT "audit_event_changes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "audit_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_sale_unit_id_fkey" FOREIGN KEY ("sale_unit_id") REFERENCES "product_variant_sale_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "catalog_price_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_table_sessions" ADD CONSTRAINT "cart_table_sessions_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_table_sessions" ADD CONSTRAINT "cart_table_sessions_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_table_sessions" ADD CONSTRAINT "cart_table_sessions_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_table_sessions" ADD CONSTRAINT "cart_table_sessions_external_table_item_id_fkey" FOREIGN KEY ("external_table_item_id") REFERENCES "integration_external_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_table_sessions" ADD CONSTRAINT "cart_table_sessions_submitted_order_id_fkey" FOREIGN KEY ("submitted_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_signups" ADD CONSTRAINT "catalog_signups_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_signups" ADD CONSTRAINT "catalog_signups_created_user_id_fkey" FOREIGN KEY ("created_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_signups" ADD CONSTRAINT "catalog_signups_created_catalog_id_fkey" FOREIGN KEY ("created_catalog_id") REFERENCES "catalogs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_sale_units" ADD CONSTRAINT "catalog_sale_units_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_feature_entitlements" ADD CONSTRAINT "catalog_feature_entitlements_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_domains" ADD CONSTRAINT "catalog_domains_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_configs" ADD CONSTRAINT "catalog_configs_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_configs" ADD CONSTRAINT "catalog_configs_logo_media_id_fkey" FOREIGN KEY ("logo_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_configs" ADD CONSTRAINT "catalog_configs_bg_media_id_fkey" FOREIGN KEY ("bg_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_contacts" ADD CONSTRAINT "catalog_contacts_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_settings" ADD CONSTRAINT "catalog_settings_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_settings" ADD CONSTRAINT "catalog_settings_active_price_list_id_fkey" FOREIGN KEY ("active_price_list_id") REFERENCES "catalog_price_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_image_media_id_fkey" FOREIGN KEY ("image_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_products" ADD CONSTRAINT "category_products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_products" ADD CONSTRAINT "category_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_event_outbox" ADD CONSTRAINT "domain_event_outbox_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_external_objects" ADD CONSTRAINT "integration_external_objects_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_entity_mappings" ADD CONSTRAINT "integration_entity_mappings_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_entity_mappings" ADD CONSTRAINT "integration_entity_mappings_external_object_id_fkey" FOREIGN KEY ("external_object_id") REFERENCES "integration_external_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_field_mappings" ADD CONSTRAINT "integration_field_mappings_entity_mapping_id_fkey" FOREIGN KEY ("entity_mapping_id") REFERENCES "integration_entity_mappings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_external_items" ADD CONSTRAINT "integration_external_items_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_external_items" ADD CONSTRAINT "integration_external_items_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_product_links" ADD CONSTRAINT "integration_product_links_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_product_links" ADD CONSTRAINT "integration_product_links_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_variant_links" ADD CONSTRAINT "integration_variant_links_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_variant_links" ADD CONSTRAINT "integration_variant_links_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_category_links" ADD CONSTRAINT "integration_category_links_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_category_links" ADD CONSTRAINT "integration_category_links_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_order_exports" ADD CONSTRAINT "integration_order_exports_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_order_exports" ADD CONSTRAINT "integration_order_exports_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_webhook_events" ADD CONSTRAINT "integration_webhook_events_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_warehouses" ADD CONSTRAINT "inventory_warehouses_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_warehouse_catalogs" ADD CONSTRAINT "inventory_warehouse_catalogs_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "inventory_warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_warehouse_catalogs" ADD CONSTRAINT "inventory_warehouse_catalogs_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_balances" ADD CONSTRAINT "inventory_stock_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "inventory_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_balances" ADD CONSTRAINT "inventory_stock_balances_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "inventory_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "inventory_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "inventory_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_cart_item_id_fkey" FOREIGN KEY ("cart_item_id") REFERENCES "cart_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_entity_maps" ADD CONSTRAINT "migration_entity_maps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "migration_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_issues" ADD CONSTRAINT "migration_issues_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "migration_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_modifier_groups" ADD CONSTRAINT "catalog_modifier_groups_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_modifier_options" ADD CONSTRAINT "catalog_modifier_options_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_modifier_group_options" ADD CONSTRAINT "catalog_modifier_group_options_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "catalog_modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_modifier_group_options" ADD CONSTRAINT "catalog_modifier_group_options_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "catalog_modifier_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_type_modifier_group_templates" ADD CONSTRAINT "product_type_modifier_group_templates_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_type_modifier_group_templates" ADD CONSTRAINT "product_type_modifier_group_templates_catalog_modifier_gro_fkey" FOREIGN KEY ("catalog_modifier_group_id") REFERENCES "catalog_modifier_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_type_modifier_option_templates" ADD CONSTRAINT "product_type_modifier_option_templates_template_group_id_fkey" FOREIGN KEY ("template_group_id") REFERENCES "product_type_modifier_group_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_type_modifier_option_templates" ADD CONSTRAINT "product_type_modifier_option_templates_catalog_modifier_op_fkey" FOREIGN KEY ("catalog_modifier_option_id") REFERENCES "catalog_modifier_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_catalog_modifier_group_id_fkey" FOREIGN KEY ("catalog_modifier_group_id") REFERENCES "catalog_modifier_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_modifier_options" ADD CONSTRAINT "product_modifier_options_product_modifier_group_id_fkey" FOREIGN KEY ("product_modifier_group_id") REFERENCES "product_modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_modifier_options" ADD CONSTRAINT "product_modifier_options_catalog_modifier_option_id_fkey" FOREIGN KEY ("catalog_modifier_option_id") REFERENCES "catalog_modifier_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_item_modifiers" ADD CONSTRAINT "cart_item_modifiers_cart_item_id_fkey" FOREIGN KEY ("cart_item_id") REFERENCES "cart_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_item_modifiers" ADD CONSTRAINT "cart_item_modifiers_product_modifier_group_id_fkey" FOREIGN KEY ("product_modifier_group_id") REFERENCES "product_modifier_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_item_modifiers" ADD CONSTRAINT "cart_item_modifiers_product_modifier_option_id_fkey" FOREIGN KEY ("product_modifier_option_id") REFERENCES "product_modifier_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_modifier_group_links" ADD CONSTRAINT "integration_modifier_group_links_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_modifier_group_links" ADD CONSTRAINT "integration_modifier_group_links_catalog_modifier_group_id_fkey" FOREIGN KEY ("catalog_modifier_group_id") REFERENCES "catalog_modifier_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_modifier_group_links" ADD CONSTRAINT "integration_modifier_group_links_product_modifier_group_id_fkey" FOREIGN KEY ("product_modifier_group_id") REFERENCES "product_modifier_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_modifier_option_links" ADD CONSTRAINT "integration_modifier_option_links_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_modifier_option_links" ADD CONSTRAINT "integration_modifier_option_links_catalog_modifier_option__fkey" FOREIGN KEY ("catalog_modifier_option_id") REFERENCES "catalog_modifier_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_modifier_option_links" ADD CONSTRAINT "integration_modifier_option_links_product_modifier_option__fkey" FOREIGN KEY ("product_modifier_option_id") REFERENCES "product_modifier_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_price_lists" ADD CONSTRAINT "catalog_price_lists_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_price_list_prices" ADD CONSTRAINT "catalog_price_list_prices_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "catalog_price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_price_list_prices" ADD CONSTRAINT "catalog_price_list_prices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_price_list_prices" ADD CONSTRAINT "catalog_price_list_prices_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_price_list_prices" ADD CONSTRAINT "catalog_price_list_prices_sale_unit_id_fkey" FOREIGN KEY ("sale_unit_id") REFERENCES "product_variant_sale_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_types" ADD CONSTRAINT "product_types_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_type_attributes" ADD CONSTRAINT "product_type_attributes_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_type_attributes" ADD CONSTRAINT "product_type_attributes_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "attributes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "attributes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_enum_value_id_fkey" FOREIGN KEY ("enum_value_id") REFERENCES "attribute_enum_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_sale_units" ADD CONSTRAINT "product_variant_sale_units_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_sale_units" ADD CONSTRAINT "product_variant_sale_units_catalog_sale_unit_id_fkey" FOREIGN KEY ("catalog_sale_unit_id") REFERENCES "catalog_sale_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regionality" ADD CONSTRAINT "regionality_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regionality" ADD CONSTRAINT "regionality_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "regionality"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_settings" ADD CONSTRAINT "seo_settings_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_settings" ADD CONSTRAINT "seo_settings_og_media_id_fkey" FOREIGN KEY ("og_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_settings" ADD CONSTRAINT "seo_settings_twitter_media_id_fkey" FOREIGN KEY ("twitter_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_settings" ADD CONSTRAINT "seo_settings_favicon_media_id_fkey" FOREIGN KEY ("favicon_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ActivityToType" ADD CONSTRAINT "_ActivityToType_A_fkey" FOREIGN KEY ("A") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ActivityToType" ADD CONSTRAINT "_ActivityToType_B_fkey" FOREIGN KEY ("B") REFERENCES "types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ActivityToCatalog" ADD CONSTRAINT "_ActivityToCatalog_A_fkey" FOREIGN KEY ("A") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ActivityToCatalog" ADD CONSTRAINT "_ActivityToCatalog_B_fkey" FOREIGN KEY ("B") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AttributeToType" ADD CONSTRAINT "_AttributeToType_A_fkey" FOREIGN KEY ("A") REFERENCES "attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AttributeToType" ADD CONSTRAINT "_AttributeToType_B_fkey" FOREIGN KEY ("B") REFERENCES "types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CatalogToRegionality" ADD CONSTRAINT "_CatalogToRegionality_A_fkey" FOREIGN KEY ("A") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CatalogToRegionality" ADD CONSTRAINT "_CatalogToRegionality_B_fkey" FOREIGN KEY ("B") REFERENCES "regionality"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CatalogToMetrics" ADD CONSTRAINT "_CatalogToMetrics_A_fkey" FOREIGN KEY ("A") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CatalogToMetrics" ADD CONSTRAINT "_CatalogToMetrics_B_fkey" FOREIGN KEY ("B") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CountryToUser" ADD CONSTRAINT "_CountryToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "countries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CountryToUser" ADD CONSTRAINT "_CountryToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RegionalityToUser" ADD CONSTRAINT "_RegionalityToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "regionality"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RegionalityToUser" ADD CONSTRAINT "_RegionalityToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
