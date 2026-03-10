CREATE TABLE `crawl_nodes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`nodeToken` varchar(64) NOT NULL,
	`objToken` varchar(64),
	`objType` varchar(32),
	`nodeType` varchar(32),
	`originNodeToken` varchar(64),
	`originSpaceId` varchar(64),
	`parentNodeToken` varchar(64),
	`title` text,
	`url` text,
	`depth` int NOT NULL DEFAULT 0,
	`hasChild` int NOT NULL DEFAULT 0,
	`objCreateTime` bigint,
	`objEditTime` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `crawl_nodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crawl_queue` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`parentToken` varchar(64),
	`fetchSpaceId` varchar(64) NOT NULL,
	`depth` int NOT NULL DEFAULT 0,
	`status` enum('pending','done','failed') NOT NULL DEFAULT 'pending',
	`retryCount` int NOT NULL DEFAULT 0,
	`errorMsg` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `crawl_queue_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crawl_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`spaceId` varchar(64) NOT NULL,
	`domain` varchar(256) NOT NULL,
	`status` enum('running','paused','done','failed') NOT NULL DEFAULT 'running',
	`totalNodes` int NOT NULL DEFAULT 0,
	`pendingQueue` int NOT NULL DEFAULT 0,
	`skippedNodes` int NOT NULL DEFAULT 0,
	`errorMsg` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crawl_sessions_id` PRIMARY KEY(`id`)
);
