using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RevelMovies.Infrastructure.Persistence.Migrations;

[DbContext(typeof(RevelMoviesDbContext))]
[Migration("20260915190000_AddGroupsAndPlaylists")]
public partial class AddGroupsAndPlaylists : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "display_groups",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                event_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                created_at = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_display_groups", x => x.id);
                table.ForeignKey(
                    name: "fk_display_groups_events_event_id",
                    column: x => x.event_id,
                    principalTable: "events",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateTable(
            name: "playlists",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                event_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                is_loop = table.Column<bool>(type: "bit", nullable: false),
                created_at = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_playlists", x => x.id);
                table.ForeignKey(
                    name: "fk_playlists_events_event_id",
                    column: x => x.event_id,
                    principalTable: "events",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateTable(
            name: "display_group_members",
            columns: table => new
            {
                display_group_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                display_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_display_group_members", x => new { x.display_group_id, x.display_id });
                table.ForeignKey(
                    name: "fk_display_group_members_displays_display_id",
                    column: x => x.display_id,
                    principalTable: "displays",
                    principalColumn: "id",
                    onDelete: ReferentialAction.NoAction);
                table.ForeignKey(
                    name: "fk_display_group_members_groups_group_id",
                    column: x => x.display_group_id,
                    principalTable: "display_groups",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateTable(
            name: "playlist_items",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                playlist_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                media_asset_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                position = table.Column<int>(type: "int", nullable: false),
                duration_seconds = table.Column<double>(type: "float", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_playlist_items", x => x.id);
                table.ForeignKey(
                    name: "fk_playlist_items_media_assets_media_asset_id",
                    column: x => x.media_asset_id,
                    principalTable: "media_assets",
                    principalColumn: "id",
                    onDelete: ReferentialAction.NoAction);
                table.ForeignKey(
                    name: "fk_playlist_items_playlists_playlist_id",
                    column: x => x.playlist_id,
                    principalTable: "playlists",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(name: "ix_display_group_members_display_id", table: "display_group_members", column: "display_id");
        migrationBuilder.CreateIndex(name: "ix_display_groups_event_id", table: "display_groups", column: "event_id");
        migrationBuilder.CreateIndex(name: "ix_playlist_items_media_asset_id", table: "playlist_items", column: "media_asset_id");
        migrationBuilder.CreateIndex(name: "ux_playlist_items_playlist_position", table: "playlist_items", columns: new[] { "playlist_id", "position" }, unique: true);
        migrationBuilder.CreateIndex(name: "ix_playlists_event_id", table: "playlists", column: "event_id");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "display_group_members");
        migrationBuilder.DropTable(name: "playlist_items");
        migrationBuilder.DropTable(name: "display_groups");
        migrationBuilder.DropTable(name: "playlists");
    }
}
