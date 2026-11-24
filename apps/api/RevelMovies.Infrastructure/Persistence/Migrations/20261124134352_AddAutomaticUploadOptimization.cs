using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RevelMovies.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAutomaticUploadOptimization : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "ReplaceOriginal",
                table: "media_optimization_jobs",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "ResultChecksum",
                table: "media_optimization_jobs",
                type: "nvarchar(max)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ReplaceOriginal",
                table: "media_optimization_jobs");

            migrationBuilder.DropColumn(
                name: "ResultChecksum",
                table: "media_optimization_jobs");
        }
    }
}
