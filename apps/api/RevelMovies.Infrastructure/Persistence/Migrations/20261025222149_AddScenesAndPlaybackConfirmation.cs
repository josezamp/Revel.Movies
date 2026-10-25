using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RevelMovies.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddScenesAndPlaybackConfirmation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "actual_command_id",
                table: "display_playback_states",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "actual_visible_json",
                table: "display_playback_states",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "blackout",
                table: "display_playback_states",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<long>(
                name: "revision",
                table: "display_playback_states",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "scene_expires_at",
                table: "display_playback_states",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "scene_session_id",
                table: "display_playback_states",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.Sql("UPDATE display_playback_states SET blackout = 1, desired_state = CASE WHEN payload_json IS NULL THEN 'Stopped' ELSE 'Playing' END WHERE desired_state = 'Blackout'");

            migrationBuilder.CreateTable(
                name: "scene_sessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    EventId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SceneId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Version = table.Column<int>(type: "int", nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    TargetsJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Fingerprint = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    RestoredAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_scene_sessions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "scenes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    EventId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Version = table.Column<int>(type: "int", nullable: false),
                    AssignmentsJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    TemporaryDurationSeconds = table.Column<int>(type: "int", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_scenes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_scenes_events_EventId",
                        column: x => x.EventId,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_scene_sessions_EventId_SceneId_CreatedAt",
                table: "scene_sessions",
                columns: new[] { "EventId", "SceneId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_scenes_EventId",
                table: "scenes",
                column: "EventId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "scene_sessions");

            migrationBuilder.DropTable(
                name: "scenes");

            migrationBuilder.DropColumn(
                name: "actual_command_id",
                table: "display_playback_states");

            migrationBuilder.DropColumn(
                name: "actual_visible_json",
                table: "display_playback_states");

            migrationBuilder.DropColumn(
                name: "blackout",
                table: "display_playback_states");

            migrationBuilder.DropColumn(
                name: "revision",
                table: "display_playback_states");

            migrationBuilder.DropColumn(
                name: "scene_expires_at",
                table: "display_playback_states");

            migrationBuilder.DropColumn(
                name: "scene_session_id",
                table: "display_playback_states");
        }
    }
}
