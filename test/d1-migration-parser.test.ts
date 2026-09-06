import { describe, expect, it } from "vitest";

import { migrationStatements } from "./apply-d1-migrations";

describe("D1 migration statement parser", () => {
	it("preserves trigger bodies, quoted semicolons, and comment keywords", () => {
		const sql = `
			-- CASE and END; in comments are not trigger delimiters.
			CREATE TABLE "events;archive" (value TEXT);

			CREATE TEMP TRIGGER activate_user
			AFTER UPDATE ON invites
			BEGIN
				/* CASE 'ignored' END; */
				UPDATE users
				SET status = CASE
					WHEN NEW.note = 'CASE; END;' THEN 'active'
					ELSE 'inactive'
				END;
				INSERT INTO logs(message) VALUES ('trigger; complete');
			END;

			INSERT INTO [events;archive] (value) VALUES ('outside; trigger');
		`;

		const statements = migrationStatements(sql);

		expect(statements).toHaveLength(3);
		expect(statements[0]).toContain('CREATE TABLE "events;archive"');
		expect(statements[1]).toContain("CREATE TEMP TRIGGER activate_user");
		expect(statements[1]).toContain("VALUES ('trigger; complete');");
		expect(statements[1]).toMatch(/END;\s*$/);
		expect(statements[2]).toContain("VALUES ('outside; trigger');");
	});
});
