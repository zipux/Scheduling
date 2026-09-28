-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trial', 'active', 'past_due', 'cancelled');

-- CreateEnum
CREATE TYPE "PayPeriodFrequency" AS ENUM ('weekly', 'biweekly', 'semimonthly', 'monthly');

-- CreateEnum
CREATE TYPE "RoundingMode" AS ENUM ('none', 'employee_favour', 'nearest');

-- CreateEnum
CREATE TYPE "GeofenceMode" AS ENUM ('required', 'warn', 'off');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('invited', 'active', 'deactivated');

-- CreateEnum
CREATE TYPE "WageType" AS ENUM ('hourly', 'salary');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('queued', 'sent', 'delivered', 'bounced', 'complained');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('pending', 'approved', 'denied', 'cancelled');

-- CreateEnum
CREATE TYPE "AvailabilityKind" AS ENUM ('all_day', 'between', 'unavailable');

-- CreateEnum
CREATE TYPE "TradeType" AS ENUM ('drop', 'pickup', 'swap');

-- CreateEnum
CREATE TYPE "PunchSource" AS ENUM ('personal', 'kiosk', 'manual', 'offline');

-- CreateEnum
CREATE TYPE "TimeFlagType" AS ENUM ('MISSING_CLOCK_OUT', 'MISSING_CLOCK_IN', 'BREAK_MISSED', 'OFFLINE_QUEUED', 'GEO_UNCERTAIN', 'GEO_OUTSIDE', 'OFFSITE', 'UNSCHEDULED', 'LATE', 'EARLY_LEAVE');

-- CreateEnum
CREATE TYPE "PayPeriodStatus" AS ENUM ('open', 'approved');

-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('open', 'approved');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "deletionRequestedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ(3),
    "refreshTokenExpiresAt" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'trial',
    "suspendedAt" TIMESTAMPTZ(3),
    "setupCompletedAt" TIMESTAMPTZ(3),
    "allowSelfTimeOffApproval" BOOLEAN NOT NULL DEFAULT true,
    "escalateAfterHours" INTEGER NOT NULL DEFAULT 72,
    "timeOffMinNoticeDays" INTEGER NOT NULL DEFAULT 0,
    "availabilityNeedsApproval" BOOLEAN NOT NULL DEFAULT false,
    "dropNeedsApproval" BOOLEAN NOT NULL DEFAULT true,
    "pickupNeedsApproval" BOOLEAN NOT NULL DEFAULT true,
    "swapNeedsApproval" BOOLEAN NOT NULL DEFAULT true,
    "minorAgeThreshold" INTEGER NOT NULL DEFAULT 19,
    "directoryShowsPhone" BOOLEAN NOT NULL DEFAULT true,
    "directoryShowsEmail" BOOLEAN NOT NULL DEFAULT true,
    "clockModePersonal" BOOLEAN NOT NULL DEFAULT true,
    "clockModeKiosk" BOOLEAN NOT NULL DEFAULT true,
    "earlyClockInMinutes" INTEGER NOT NULL DEFAULT 10,
    "allowUnscheduledClockIn" BOOLEAN NOT NULL DEFAULT true,
    "roundingMode" "RoundingMode" NOT NULL DEFAULT 'none',
    "roundingIntervalMinutes" INTEGER NOT NULL DEFAULT 0,
    "lateToleranceMinutes" INTEGER NOT NULL DEFAULT 5,
    "maxShiftHours" INTEGER NOT NULL DEFAULT 16,
    "maxClockSkewMinutes" INTEGER NOT NULL DEFAULT 30,
    "payPeriodFrequency" "PayPeriodFrequency" NOT NULL DEFAULT 'biweekly',
    "payPeriodAnchorDate" DATE,
    "workDayStartMinutes" INTEGER NOT NULL DEFAULT 240,
    "vacationPayPercent" DECIMAL(6,3) NOT NULL DEFAULT 4,
    "burdenPercent" DECIMAL(6,3),
    "burdenNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "timezone" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "radiusM" INTEGER NOT NULL DEFAULT 100,
    "geofenceMode" "GeofenceMode" NOT NULL DEFAULT 'warn',
    "isTemporary" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "displayName" TEXT,
    "hireDate" DATE,
    "accessRevokedAt" TIMESTAMPTZ(3),
    "employmentEndedAt" DATE,
    "preferredLocationId" TEXT,
    "preferAllLocations" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeProfile" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "phone" TEXT,
    "dateOfBirth" DATE,
    "address" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactRelation" TEXT,
    "emergencyContactPhone" TEXT,
    "photoUrl" TEXT,
    "pinHmac" TEXT,
    "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PinAttempt" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "kioskDeviceId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PinAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "requiresMinimumAge" INTEGER,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipPosition" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,

    CONSTRAINT "MembershipPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipLocation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,

    CONSTRAINT "MembershipLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wage" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "positionId" TEXT,
    "rateCents" INTEGER NOT NULL,
    "type" "WageType" NOT NULL DEFAULT 'hourly',
    "effectiveFrom" DATE NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "locationIds" TEXT[],
    "positionIds" TEXT[],
    "wageCents" INTEGER,
    "hireDate" DATE,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'queued',
    "lastEmailLogId" TEXT,
    "invitedById" TEXT,
    "acceptedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "positionId" TEXT,
    "membershipId" TEXT,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "ShiftStatus" NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "geofenceOverride" JSONB,
    "publishedSnapshot" JSONB,
    "publishedAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftTemplate" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT,
    "positionId" TEXT,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityRule" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "kind" "AvailabilityKind" NOT NULL,
    "startMinutes" INTEGER,
    "endMinutes" INTEGER,
    "effectiveFrom" DATE NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'pending',
    "reviewerId" TEXT,
    "reviewerNote" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeOffRequest" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'pending',
    "reviewerId" TEXT,
    "reviewerNote" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "escalatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TimeOffRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlackoutPeriod" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "locationId" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlackoutPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftTradeRequest" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" "TradeType" NOT NULL,
    "shiftId" TEXT NOT NULL,
    "fromMembershipId" TEXT,
    "toMembershipId" TEXT,
    "swapShiftId" TEXT,
    "coworkerAcceptedAt" TIMESTAMPTZ(3),
    "status" "RequestStatus" NOT NULL DEFAULT 'pending',
    "reviewerId" TEXT,
    "reviewerNote" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "escalatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShiftTradeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleConflict" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolution" TEXT,
    "resolvedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskDevice" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "enrolledById" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KioskDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "shiftId" TEXT,
    "positionId" TEXT,
    "clockIn" TIMESTAMPTZ(3),
    "clockOut" TIMESTAMPTZ(3),
    "clockInRounded" TIMESTAMPTZ(3),
    "clockOutRounded" TIMESTAMPTZ(3),
    "inLat" DOUBLE PRECISION,
    "inLng" DOUBLE PRECISION,
    "inAccuracy" DOUBLE PRECISION,
    "outLat" DOUBLE PRECISION,
    "outLng" DOUBLE PRECISION,
    "outAccuracy" DOUBLE PRECISION,
    "source" "PunchSource" NOT NULL DEFAULT 'personal',
    "inDeviceTime" TIMESTAMPTZ(3),
    "inServerTime" TIMESTAMPTZ(3),
    "outDeviceTime" TIMESTAMPTZ(3),
    "outServerTime" TIMESTAMPTZ(3),
    "kioskDeviceId" TEXT,
    "lockedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntryFlag" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "timeEntryId" TEXT NOT NULL,
    "type" "TimeFlagType" NOT NULL,
    "detail" JSONB,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedById" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntryFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "timeEntryId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3),
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreakEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakRule" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "afterHours" DECIMAL(5,2) NOT NULL,
    "breakMinutes" INTEGER NOT NULL,
    "paidWhenNotTaken" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreakRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntryAudit" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "timeEntryId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntryAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionRequest" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "timeEntryId" TEXT,
    "proposedClockIn" TIMESTAMPTZ(3),
    "proposedClockOut" TIMESTAMPTZ(3),
    "message" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'pending',
    "reviewerId" TEXT,
    "reviewerNote" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRules" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "presetKey" TEXT,
    "confirmedAt" TIMESTAMPTZ(3),
    "confirmedById" TEXT,
    "dailyThresholdHours" DECIMAL(5,2),
    "dailyMultiplier" DECIMAL(4,2),
    "dailySecondThresholdHours" DECIMAL(5,2),
    "dailySecondMultiplier" DECIMAL(4,2),
    "weeklyThresholdHours" DECIMAL(5,2),
    "weeklyMultiplier" DECIMAL(4,2),
    "minimumDailyPayHours" DECIMAL(5,2),
    "maxSplitShiftSpanHours" DECIMAL(5,2),
    "holidayMinEmploymentDays" INTEGER NOT NULL DEFAULT 0,
    "holidayMinDaysWorkedLookback" INTEGER NOT NULL DEFAULT 0,
    "holidayLookbackDays" INTEGER NOT NULL DEFAULT 28,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PayRules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayPeriod" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "PayPeriodStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timesheet" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "payPeriodId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'open',
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "totals" JSONB,
    "grossCents" INTEGER,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "approvedWithExceptions" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "isStatutory" BOOLEAN NOT NULL DEFAULT true,
    "premiumMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 1.5,
    "eligibilityRule" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HolidayEntitlement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "holidayId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "worked" BOOLEAN NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "inputs" JSONB NOT NULL,
    "premiumHours" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "overrideEligible" BOOLEAN,
    "overrideReason" TEXT,
    "overrideById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "HolidayEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VacationAccrual" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "timesheetId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VacationAccrual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "autoKey" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMember" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "lastReadAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderMembershipId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentUrl" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "senderMembershipId" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "requireReadConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementRead" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "batchKey" TEXT,
    "flushAfter" TIMESTAMPTZ(3),
    "emailedAt" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "email" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "providerId" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "Location_businessId_idx" ON "Location"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_id_businessId_key" ON "Location"("id", "businessId");

-- CreateIndex
CREATE INDEX "Role_businessId_idx" ON "Role"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_id_businessId_key" ON "Role"("id", "businessId");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_businessId_userId_key" ON "Membership"("businessId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_id_businessId_key" ON "Membership"("id", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeProfile_membershipId_key" ON "EmployeeProfile"("membershipId");

-- CreateIndex
CREATE INDEX "EmployeeProfile_businessId_idx" ON "EmployeeProfile"("businessId");

-- CreateIndex
CREATE INDEX "PinAttempt_businessId_membershipId_createdAt_idx" ON "PinAttempt"("businessId", "membershipId", "createdAt");

-- CreateIndex
CREATE INDEX "Position_businessId_idx" ON "Position"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Position_id_businessId_key" ON "Position"("id", "businessId");

-- CreateIndex
CREATE INDEX "MembershipPosition_businessId_idx" ON "MembershipPosition"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPosition_membershipId_positionId_key" ON "MembershipPosition"("membershipId", "positionId");

-- CreateIndex
CREATE INDEX "MembershipLocation_businessId_idx" ON "MembershipLocation"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipLocation_membershipId_locationId_key" ON "MembershipLocation"("membershipId", "locationId");

-- CreateIndex
CREATE INDEX "Wage_businessId_membershipId_effectiveFrom_idx" ON "Wage"("businessId", "membershipId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_businessId_status_idx" ON "Invitation"("businessId", "status");

-- CreateIndex
CREATE INDEX "Shift_businessId_startsAt_idx" ON "Shift"("businessId", "startsAt");

-- CreateIndex
CREATE INDEX "Shift_businessId_membershipId_startsAt_idx" ON "Shift"("businessId", "membershipId", "startsAt");

-- CreateIndex
CREATE INDEX "ShiftTemplate_businessId_idx" ON "ShiftTemplate"("businessId");

-- CreateIndex
CREATE INDEX "AvailabilityRule_businessId_membershipId_effectiveFrom_idx" ON "AvailabilityRule"("businessId", "membershipId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "TimeOffRequest_businessId_membershipId_startsAt_idx" ON "TimeOffRequest"("businessId", "membershipId", "startsAt");

-- CreateIndex
CREATE INDEX "BlackoutPeriod_businessId_startDate_idx" ON "BlackoutPeriod"("businessId", "startDate");

-- CreateIndex
CREATE INDEX "ShiftTradeRequest_businessId_shiftId_idx" ON "ShiftTradeRequest"("businessId", "shiftId");

-- CreateIndex
CREATE INDEX "ScheduleConflict_businessId_resolvedAt_idx" ON "ScheduleConflict"("businessId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KioskDevice_tokenHash_key" ON "KioskDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "KioskDevice_businessId_idx" ON "KioskDevice"("businessId");

-- CreateIndex
CREATE INDEX "TimeEntry_businessId_membershipId_clockIn_idx" ON "TimeEntry"("businessId", "membershipId", "clockIn");

-- CreateIndex
CREATE INDEX "TimeEntry_businessId_clockIn_idx" ON "TimeEntry"("businessId", "clockIn");

-- CreateIndex
CREATE INDEX "TimeEntryFlag_businessId_resolvedAt_idx" ON "TimeEntryFlag"("businessId", "resolvedAt");

-- CreateIndex
CREATE INDEX "TimeEntryFlag_timeEntryId_idx" ON "TimeEntryFlag"("timeEntryId");

-- CreateIndex
CREATE INDEX "BreakEntry_timeEntryId_idx" ON "BreakEntry"("timeEntryId");

-- CreateIndex
CREATE INDEX "BreakRule_businessId_idx" ON "BreakRule"("businessId");

-- CreateIndex
CREATE INDEX "TimeEntryAudit_businessId_timeEntryId_idx" ON "TimeEntryAudit"("businessId", "timeEntryId");

-- CreateIndex
CREATE INDEX "CorrectionRequest_businessId_status_idx" ON "CorrectionRequest"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayRules_businessId_key" ON "PayRules"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "PayPeriod_businessId_startDate_key" ON "PayPeriod"("businessId", "startDate");

-- CreateIndex
CREATE INDEX "Timesheet_businessId_idx" ON "Timesheet"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_payPeriodId_membershipId_key" ON "Timesheet"("payPeriodId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_businessId_date_name_key" ON "Holiday"("businessId", "date", "name");

-- CreateIndex
CREATE INDEX "HolidayEntitlement_businessId_idx" ON "HolidayEntitlement"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "HolidayEntitlement_holidayId_membershipId_key" ON "HolidayEntitlement"("holidayId", "membershipId");

-- CreateIndex
CREATE INDEX "VacationAccrual_businessId_membershipId_idx" ON "VacationAccrual"("businessId", "membershipId");

-- CreateIndex
CREATE INDEX "Conversation_businessId_idx" ON "Conversation"("businessId");

-- CreateIndex
CREATE INDEX "ConversationMember_businessId_membershipId_idx" ON "ConversationMember"("businessId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMember_conversationId_membershipId_key" ON "ConversationMember"("conversationId", "membershipId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_businessId_idx" ON "Message"("businessId");

-- CreateIndex
CREATE INDEX "Announcement_businessId_createdAt_idx" ON "Announcement"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementRead_announcementId_membershipId_key" ON "AnnouncementRead"("announcementId", "membershipId");

-- CreateIndex
CREATE INDEX "Notification_businessId_membershipId_readAt_idx" ON "Notification"("businessId", "membershipId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_flushAfter_idx" ON "Notification"("flushAfter");

-- CreateIndex
CREATE INDEX "NotificationPreference_businessId_idx" ON "NotificationPreference"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_membershipId_type_key" ON "NotificationPreference"("membershipId", "type");

-- CreateIndex
CREATE INDEX "AuditLog_businessId_createdAt_idx" ON "AuditLog"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLog_providerId_key" ON "EmailLog"("providerId");

-- CreateIndex
CREATE INDEX "EmailLog_createdAt_idx" ON "EmailLog"("createdAt");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipPosition" ADD CONSTRAINT "MembershipPosition_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipPosition" ADD CONSTRAINT "MembershipPosition_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipLocation" ADD CONSTRAINT "MembershipLocation_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipLocation" ADD CONSTRAINT "MembershipLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wage" ADD CONSTRAINT "Wage_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskDevice" ADD CONSTRAINT "KioskDevice_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntryFlag" ADD CONSTRAINT "TimeEntryFlag_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "TimeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakEntry" ADD CONSTRAINT "BreakEntry_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "TimeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakRule" ADD CONSTRAINT "BreakRule_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRules" ADD CONSTRAINT "PayRules_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Spec §6.3: at most one pending-or-approved claim (pickup) per shift.
CREATE UNIQUE INDEX "ShiftTradeRequest_one_active_pickup_per_shift"
  ON "ShiftTradeRequest" ("shiftId")
  WHERE "type" = 'pickup' AND "status" IN ('pending', 'approved');
