CREATE TABLE `managed_admin_credential` (
	`userId` text PRIMARY KEY,
	`email` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_managed_admin_credential_email` ON `managed_admin_credential` (`email`);