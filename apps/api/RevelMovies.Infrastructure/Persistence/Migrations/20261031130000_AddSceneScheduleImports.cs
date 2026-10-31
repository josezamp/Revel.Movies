using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RevelMovies.Infrastructure.Persistence.Migrations;

[DbContext(typeof(RevelMoviesDbContext))]
[Migration("20261031130000_AddSceneScheduleImports")]
public partial class AddSceneScheduleImports : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "scene_schedule_imports",
            columns: table => new
            {
                EventId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                PackageHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                PreviewJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                SceneCount = table.Column<int>(type: "int", nullable: false),
                ScheduleCount = table.Column<int>(type: "int", nullable: false),
                CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_scene_schedule_imports", x => new { x.EventId, x.PackageHash });
                table.ForeignKey(name: "FK_scene_schedule_imports_events_EventId", column: x => x.EventId,
                    principalTable: "events", principalColumn: "id", onDelete: ReferentialAction.Cascade);
            });
    }

    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.DropTable(name: "scene_schedule_imports");
}
