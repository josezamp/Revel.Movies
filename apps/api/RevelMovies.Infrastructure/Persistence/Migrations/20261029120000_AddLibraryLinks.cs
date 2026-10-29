using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RevelMovies.Infrastructure.Persistence.Migrations;

[DbContext(typeof(RevelMoviesDbContext))]
[Migration("20261029120000_AddLibraryLinks")]
public partial class AddLibraryLinks : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) =>
        migrationBuilder.AddColumn<string>(name: "url", table: "media_assets",
            type: "nvarchar(2048)", maxLength: 2048, nullable: true);

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropColumn(name: "url", table: "media_assets");
}
