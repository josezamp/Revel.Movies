using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RevelMovies.Infrastructure.Persistence.Migrations;

[DbContext(typeof(RevelMoviesDbContext))]
[Migration("20261017120000_AddWebPages")]
public partial class AddWebPages : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) =>
        migrationBuilder.AddColumn<string>(name: "web_page_json", table: "display_playback_states",
            type: "nvarchar(max)", nullable: true);

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropColumn(name: "web_page_json", table: "display_playback_states");
}
