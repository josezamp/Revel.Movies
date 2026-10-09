using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RevelMovies.Infrastructure.Persistence.Migrations;

[DbContext(typeof(RevelMoviesDbContext))]
[Migration("20261009120000_AddPromotionalBreaks")]
public partial class AddPromotionalBreaks : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(name: "promotion_policy_json", table: "display_playback_states", type: "nvarchar(max)", nullable: true);
        migrationBuilder.AddColumn<string>(name: "promotion_progress_json", table: "display_playback_states", type: "nvarchar(max)", nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "promotion_policy_json", table: "display_playback_states");
        migrationBuilder.DropColumn(name: "promotion_progress_json", table: "display_playback_states");
    }
}
