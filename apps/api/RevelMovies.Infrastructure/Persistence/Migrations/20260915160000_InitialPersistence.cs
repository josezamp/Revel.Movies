using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RevelMovies.Infrastructure.Persistence.Migrations;

public partial class InitialPersistence : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "events",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                slug = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                starts_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                ends_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                time_zone = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                status = table.Column<int>(type: "integer", nullable: false),
                created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_events", x => x.id);
            });

        migrationBuilder.CreateTable(
            name: "pairing_sessions",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                session_token = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                code = table.Column<string>(type: "character varying(6)", maxLength: 6, nullable: false),
                created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                display_id = table.Column<Guid>(type: "uuid", nullable: true),
                device_token = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                paired_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_pairing_sessions", x => x.id);
            });

        migrationBuilder.CreateTable(
            name: "displays",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                event_id = table.Column<Guid>(type: "uuid", nullable: false),
                name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                device_token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                status = table.Column<int>(type: "integer", nullable: false),
                last_seen_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_displays", x => x.id);
                table.ForeignKey(
                    name: "fk_displays_events_event_id",
                    column: x => x.event_id,
                    principalTable: "events",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "ix_displays_event_id",
            table: "displays",
            column: "event_id");

        migrationBuilder.CreateIndex(
            name: "ux_displays_device_token_hash",
            table: "displays",
            column: "device_token_hash",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "ux_events_slug",
            table: "events",
            column: "slug",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "ix_pairing_sessions_code",
            table: "pairing_sessions",
            column: "code");

        migrationBuilder.CreateIndex(
            name: "ux_pairing_sessions_session_token",
            table: "pairing_sessions",
            column: "session_token",
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "displays");
        migrationBuilder.DropTable(name: "pairing_sessions");
        migrationBuilder.DropTable(name: "events");
    }
}
