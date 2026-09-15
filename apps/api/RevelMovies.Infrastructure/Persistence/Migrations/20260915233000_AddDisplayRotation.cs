using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RevelMovies.Infrastructure.Persistence.Migrations;

[DbContext(typeof(RevelMoviesDbContext))]
[Migration("20260915233000_AddDisplayRotation")]
public partial class AddDisplayRotation : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<int>(
            name: "rotation",
            table: "displays",
            type: "int",
            nullable: false,
            defaultValue: 0);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "rotation",
            table: "displays");
    }
}
