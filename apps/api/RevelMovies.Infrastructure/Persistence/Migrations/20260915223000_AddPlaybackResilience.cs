using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RevelMovies.Infrastructure.Persistence.Migrations;

[DbContext(typeof(RevelMoviesDbContext))]
[Migration("20260915223000_AddPlaybackResilience")]
public partial class AddPlaybackResilience : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "display_playback_states",
            columns: table => new
            {
                display_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                desired_state = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                content_type = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: true),
                media_asset_id = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                playlist_id = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                payload_json = table.Column<string>(type: "nvarchar(max)", nullable: true),
                started_at = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                paused_position_seconds = table.Column<double>(type: "float", nullable: true),
                last_command_id = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                actual_state = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                actual_media_asset_id = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                actual_playlist_id = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                actual_playlist_index = table.Column<int>(type: "int", nullable: true),
                actual_position_seconds = table.Column<double>(type: "float", nullable: true),
                actual_duration_seconds = table.Column<double>(type: "float", nullable: true),
                actual_reported_at = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                drift_ms = table.Column<double>(type: "float", nullable: true),
                health = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_display_playback_states", x => x.display_id);
                table.ForeignKey(
                    name: "fk_display_playback_states_displays_display_id",
                    column: x => x.display_id,
                    principalTable: "displays",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "display_playback_states");
    }
}
