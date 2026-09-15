using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RevelMovies.Infrastructure.Persistence.Migrations;

[DbContext(typeof(RevelMoviesDbContext))]
[Migration("20260915180000_AddMediaLibrary")]
public partial class AddMediaLibrary : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "media_assets",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                event_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                type = table.Column<int>(type: "int", nullable: false),
                mime_type = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                file_name = table.Column<string>(type: "nvarchar(260)", maxLength: 260, nullable: false),
                storage_key = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                file_size = table.Column<long>(type: "bigint", nullable: false),
                duration_seconds = table.Column<double>(type: "float", nullable: true),
                width = table.Column<int>(type: "int", nullable: true),
                height = table.Column<int>(type: "int", nullable: true),
                checksum = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                created_at = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_media_assets", x => x.id);
                table.ForeignKey(
                    name: "fk_media_assets_events_event_id",
                    column: x => x.event_id,
                    principalTable: "events",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "ix_media_assets_checksum",
            table: "media_assets",
            column: "checksum");

        migrationBuilder.CreateIndex(
            name: "ix_media_assets_event_id",
            table: "media_assets",
            column: "event_id");

        migrationBuilder.CreateIndex(
            name: "ux_media_assets_storage_key",
            table: "media_assets",
            column: "storage_key",
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "media_assets");
    }
}
