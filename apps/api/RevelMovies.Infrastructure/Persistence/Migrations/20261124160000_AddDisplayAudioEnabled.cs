using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RevelMovies.Infrastructure.Persistence.Migrations;

public partial class AddDisplayAudioEnabled : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<bool>(
            name: "audio_enabled",
            table: "displays",
            type: "bit",
            nullable: false,
            defaultValue: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "audio_enabled",
            table: "displays");
    }
}
