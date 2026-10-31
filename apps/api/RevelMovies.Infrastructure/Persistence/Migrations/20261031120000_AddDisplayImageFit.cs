using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RevelMovies.Infrastructure.Persistence.Migrations;

[DbContext(typeof(RevelMoviesDbContext))]
[Migration("20261031120000_AddDisplayImageFit")]
public partial class AddDisplayImageFit : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "image_fit",
            table: "displays",
            type: "nvarchar(16)",
            maxLength: 16,
            nullable: false,
            defaultValue: "contain");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "image_fit",
            table: "displays");
    }
}
