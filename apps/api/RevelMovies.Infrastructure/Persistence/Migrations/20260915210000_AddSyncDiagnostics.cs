using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RevelMovies.Infrastructure.Persistence.Migrations;

[DbContext(typeof(RevelMoviesDbContext))]
[Migration("20260915210000_AddSyncDiagnostics")]
public partial class AddSyncDiagnostics : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<double>(
            name: "clock_offset_ms",
            table: "displays",
            type: "float",
            nullable: true);

        migrationBuilder.AddColumn<DateTimeOffset>(
            name: "last_clock_sync_at",
            table: "displays",
            type: "datetimeoffset",
            nullable: true);

        migrationBuilder.AddColumn<double>(
            name: "round_trip_ms",
            table: "displays",
            type: "float",
            nullable: true);

        migrationBuilder.CreateTable(
            name: "command_acknowledgements",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                display_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                command_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                command_type = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                status = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                detail = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                client_timestamp = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                server_received_at = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_command_acknowledgements", x => x.id);
                table.ForeignKey(
                    name: "fk_command_ack_displays_display_id",
                    column: x => x.display_id,
                    principalTable: "displays",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "ix_command_ack_display_received",
            table: "command_acknowledgements",
            columns: new[] { "display_id", "server_received_at" });

        migrationBuilder.CreateIndex(
            name: "ux_command_ack_display_command_status",
            table: "command_acknowledgements",
            columns: new[] { "display_id", "command_id", "status" },
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "command_acknowledgements");

        migrationBuilder.DropColumn(name: "clock_offset_ms", table: "displays");
        migrationBuilder.DropColumn(name: "last_clock_sync_at", table: "displays");
        migrationBuilder.DropColumn(name: "round_trip_ms", table: "displays");
    }
}
