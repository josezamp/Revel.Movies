using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RevelMovies.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddMediaOptimizationJobs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "media_optimization_jobs",
                columns: table => new
                {
                    MediaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    EventId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SourceChecksum = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    SourceStorageKey = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    OriginalSize = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Progress = table.Column<int>(type: "int", nullable: false),
                    ResultMediaId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    OptimizedSize = table.Column<long>(type: "bigint", nullable: true),
                    Error = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    LeaseId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    LeaseExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_media_optimization_jobs", x => x.MediaId);
                    table.ForeignKey(
                        name: "FK_media_optimization_jobs_media_assets_MediaId",
                        column: x => x.MediaId,
                        principalTable: "media_assets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_media_optimization_jobs_EventId",
                table: "media_optimization_jobs",
                column: "EventId");

            migrationBuilder.CreateIndex(
                name: "IX_media_optimization_jobs_Status_LeaseExpiresAt",
                table: "media_optimization_jobs",
                columns: new[] { "Status", "LeaseExpiresAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "media_optimization_jobs");
        }
    }
}
