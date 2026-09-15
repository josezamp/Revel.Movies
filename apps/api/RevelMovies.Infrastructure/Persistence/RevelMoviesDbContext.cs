using Microsoft.EntityFrameworkCore;
using RevelMovies.Domain.Commands;
using RevelMovies.Domain.DisplayGroups;
using RevelMovies.Domain.Displays;
using RevelMovies.Domain.Media;
using RevelMovies.Domain.Pairing;
using RevelMovies.Domain.Playback;
using RevelMovies.Domain.Playlists;
using RevelEvent = RevelMovies.Domain.Events.Event;

namespace RevelMovies.Infrastructure.Persistence;

public sealed class RevelMoviesDbContext(DbContextOptions<RevelMoviesDbContext> options) : DbContext(options)
{
    public DbSet<RevelEvent> Events => Set<RevelEvent>();
    public DbSet<Display> Displays => Set<Display>();
    public DbSet<PairingSession> PairingSessions => Set<PairingSession>();
    public DbSet<MediaAsset> MediaAssets => Set<MediaAsset>();
    public DbSet<DisplayGroup> DisplayGroups => Set<DisplayGroup>();
    public DbSet<DisplayGroupMember> DisplayGroupMembers => Set<DisplayGroupMember>();
    public DbSet<Playlist> Playlists => Set<Playlist>();
    public DbSet<PlaylistItem> PlaylistItems => Set<PlaylistItem>();
    public DbSet<CommandAcknowledgement> CommandAcknowledgements => Set<CommandAcknowledgement>();
    public DbSet<DisplayPlaybackState> DisplayPlaybackStates => Set<DisplayPlaybackState>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<RevelEvent>(builder =>
        {
            builder.ToTable("events");
            builder.HasKey(x => x.Id).HasName("pk_events");
            builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
            builder.Property(x => x.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
            builder.Property(x => x.Slug).HasColumnName("slug").HasMaxLength(200).IsRequired();
            builder.Property(x => x.StartsAt).HasColumnName("starts_at");
            builder.Property(x => x.EndsAt).HasColumnName("ends_at");
            builder.Property(x => x.TimeZone).HasColumnName("time_zone").HasMaxLength(100).IsRequired();
            builder.Property(x => x.Status).HasColumnName("status").IsRequired();
            builder.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
            builder.Property(x => x.UpdatedAt).HasColumnName("updated_at").IsRequired();
            builder.HasIndex(x => x.Slug).IsUnique().HasDatabaseName("ux_events_slug");
        });

        modelBuilder.Entity<Display>(builder =>
        {
            builder.ToTable("displays");
            builder.HasKey(x => x.Id).HasName("pk_displays");
            builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
            builder.Property(x => x.EventId).HasColumnName("event_id").IsRequired();
            builder.Property(x => x.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
            builder.Property(x => x.DeviceTokenHash).HasColumnName("device_token_hash").HasMaxLength(64).IsRequired();
            builder.Property(x => x.Status).HasColumnName("status").IsRequired();
            builder.Property(x => x.LastSeenAt).HasColumnName("last_seen_at");
            builder.Property(x => x.ClockOffsetMs).HasColumnName("clock_offset_ms");
            builder.Property(x => x.RoundTripMs).HasColumnName("round_trip_ms");
            builder.Property(x => x.LastClockSyncAt).HasColumnName("last_clock_sync_at");
            builder.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
            builder.Property(x => x.UpdatedAt).HasColumnName("updated_at").IsRequired();
            builder.HasIndex(x => x.EventId).HasDatabaseName("ix_displays_event_id");
            builder.HasIndex(x => x.DeviceTokenHash).IsUnique().HasDatabaseName("ux_displays_device_token_hash");
            builder.HasOne<RevelEvent>()
                .WithMany()
                .HasForeignKey(x => x.EventId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("fk_displays_events_event_id");
        });

        modelBuilder.Entity<PairingSession>(builder =>
        {
            builder.ToTable("pairing_sessions");
            builder.HasKey(x => x.Id).HasName("pk_pairing_sessions");
            builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
            builder.Property(x => x.SessionToken).HasColumnName("session_token").HasMaxLength(64).IsRequired();
            builder.Property(x => x.Code).HasColumnName("code").HasMaxLength(6).IsRequired();
            builder.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
            builder.Property(x => x.ExpiresAt).HasColumnName("expires_at").IsRequired();
            builder.Property(x => x.DisplayId).HasColumnName("display_id");
            builder.Property(x => x.DeviceToken).HasColumnName("device_token").HasMaxLength(128);
            builder.Property(x => x.PairedAt).HasColumnName("paired_at");
            builder.Ignore(x => x.IsPaired);
            builder.HasIndex(x => x.SessionToken).IsUnique().HasDatabaseName("ux_pairing_sessions_session_token");
            builder.HasIndex(x => x.Code).HasDatabaseName("ix_pairing_sessions_code");
        });

        modelBuilder.Entity<MediaAsset>(builder =>
        {
            builder.ToTable("media_assets");
            builder.HasKey(x => x.Id).HasName("pk_media_assets");
            builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
            builder.Property(x => x.EventId).HasColumnName("event_id").IsRequired();
            builder.Property(x => x.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
            builder.Property(x => x.Type).HasColumnName("type").IsRequired();
            builder.Property(x => x.MimeType).HasColumnName("mime_type").HasMaxLength(100).IsRequired();
            builder.Property(x => x.FileName).HasColumnName("file_name").HasMaxLength(260).IsRequired();
            builder.Property(x => x.StorageKey).HasColumnName("storage_key").HasMaxLength(450).IsRequired();
            builder.Property(x => x.FileSize).HasColumnName("file_size").IsRequired();
            builder.Property(x => x.DurationSeconds).HasColumnName("duration_seconds");
            builder.Property(x => x.Width).HasColumnName("width");
            builder.Property(x => x.Height).HasColumnName("height");
            builder.Property(x => x.Checksum).HasColumnName("checksum").HasMaxLength(64).IsRequired();
            builder.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
            builder.HasIndex(x => x.EventId).HasDatabaseName("ix_media_assets_event_id");
            builder.HasIndex(x => x.Checksum).HasDatabaseName("ix_media_assets_checksum");
            builder.HasIndex(x => x.StorageKey).IsUnique().HasDatabaseName("ux_media_assets_storage_key");
            builder.HasOne<RevelEvent>()
                .WithMany()
                .HasForeignKey(x => x.EventId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("fk_media_assets_events_event_id");
        });

        modelBuilder.Entity<DisplayGroup>(builder =>
        {
            builder.ToTable("display_groups");
            builder.HasKey(x => x.Id).HasName("pk_display_groups");
            builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
            builder.Property(x => x.EventId).HasColumnName("event_id").IsRequired();
            builder.Property(x => x.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
            builder.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
            builder.Property(x => x.UpdatedAt).HasColumnName("updated_at").IsRequired();
            builder.HasIndex(x => x.EventId).HasDatabaseName("ix_display_groups_event_id");
            builder.HasOne<RevelEvent>()
                .WithMany()
                .HasForeignKey(x => x.EventId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("fk_display_groups_events_event_id");
        });

        modelBuilder.Entity<DisplayGroupMember>(builder =>
        {
            builder.ToTable("display_group_members");
            builder.HasKey(x => new { x.DisplayGroupId, x.DisplayId }).HasName("pk_display_group_members");
            builder.Property(x => x.DisplayGroupId).HasColumnName("display_group_id");
            builder.Property(x => x.DisplayId).HasColumnName("display_id");
            builder.HasIndex(x => x.DisplayId).HasDatabaseName("ix_display_group_members_display_id");
            builder.HasOne<DisplayGroup>()
                .WithMany()
                .HasForeignKey(x => x.DisplayGroupId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("fk_display_group_members_groups_group_id");
            builder.HasOne<Display>()
                .WithMany()
                .HasForeignKey(x => x.DisplayId)
                .OnDelete(DeleteBehavior.Restrict)
                .HasConstraintName("fk_display_group_members_displays_display_id");
        });

        modelBuilder.Entity<Playlist>(builder =>
        {
            builder.ToTable("playlists");
            builder.HasKey(x => x.Id).HasName("pk_playlists");
            builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
            builder.Property(x => x.EventId).HasColumnName("event_id").IsRequired();
            builder.Property(x => x.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
            builder.Property(x => x.IsLoop).HasColumnName("is_loop").IsRequired();
            builder.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
            builder.Property(x => x.UpdatedAt).HasColumnName("updated_at").IsRequired();
            builder.HasIndex(x => x.EventId).HasDatabaseName("ix_playlists_event_id");
            builder.HasOne<RevelEvent>()
                .WithMany()
                .HasForeignKey(x => x.EventId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("fk_playlists_events_event_id");
        });

        modelBuilder.Entity<PlaylistItem>(builder =>
        {
            builder.ToTable("playlist_items");
            builder.HasKey(x => x.Id).HasName("pk_playlist_items");
            builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
            builder.Property(x => x.PlaylistId).HasColumnName("playlist_id").IsRequired();
            builder.Property(x => x.MediaAssetId).HasColumnName("media_asset_id").IsRequired();
            builder.Property(x => x.Position).HasColumnName("position").IsRequired();
            builder.Property(x => x.DurationSeconds).HasColumnName("duration_seconds");
            builder.HasIndex(x => new { x.PlaylistId, x.Position }).IsUnique().HasDatabaseName("ux_playlist_items_playlist_position");
            builder.HasIndex(x => x.MediaAssetId).HasDatabaseName("ix_playlist_items_media_asset_id");
            builder.HasOne<Playlist>()
                .WithMany()
                .HasForeignKey(x => x.PlaylistId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("fk_playlist_items_playlists_playlist_id");
            builder.HasOne<MediaAsset>()
                .WithMany()
                .HasForeignKey(x => x.MediaAssetId)
                .OnDelete(DeleteBehavior.Restrict)
                .HasConstraintName("fk_playlist_items_media_assets_media_asset_id");
        });

        modelBuilder.Entity<CommandAcknowledgement>(builder =>
        {
            builder.ToTable("command_acknowledgements");
            builder.HasKey(x => x.Id).HasName("pk_command_acknowledgements");
            builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
            builder.Property(x => x.DisplayId).HasColumnName("display_id").IsRequired();
            builder.Property(x => x.CommandId).HasColumnName("command_id").IsRequired();
            builder.Property(x => x.CommandType).HasColumnName("command_type").HasMaxLength(100).IsRequired();
            builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(40).IsRequired();
            builder.Property(x => x.Detail).HasColumnName("detail").HasMaxLength(500);
            builder.Property(x => x.ClientTimestamp).HasColumnName("client_timestamp");
            builder.Property(x => x.ServerReceivedAt).HasColumnName("server_received_at").IsRequired();
            builder.HasIndex(x => new { x.DisplayId, x.CommandId, x.Status })
                .IsUnique()
                .HasDatabaseName("ux_command_ack_display_command_status");
            builder.HasIndex(x => new { x.DisplayId, x.ServerReceivedAt })
                .HasDatabaseName("ix_command_ack_display_received");
            builder.HasOne<Display>()
                .WithMany()
                .HasForeignKey(x => x.DisplayId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("fk_command_ack_displays_display_id");
        });

        modelBuilder.Entity<DisplayPlaybackState>(builder =>
        {
            builder.ToTable("display_playback_states");
            builder.HasKey(x => x.DisplayId).HasName("pk_display_playback_states");
            builder.Property(x => x.DisplayId).HasColumnName("display_id").ValueGeneratedNever();
            builder.Property(x => x.DesiredState).HasColumnName("desired_state").HasMaxLength(40).IsRequired();
            builder.Property(x => x.ContentType).HasColumnName("content_type").HasMaxLength(40);
            builder.Property(x => x.MediaAssetId).HasColumnName("media_asset_id");
            builder.Property(x => x.PlaylistId).HasColumnName("playlist_id");
            builder.Property(x => x.PayloadJson).HasColumnName("payload_json");
            builder.Property(x => x.StartedAt).HasColumnName("started_at");
            builder.Property(x => x.PausedPositionSeconds).HasColumnName("paused_position_seconds");
            builder.Property(x => x.LastCommandId).HasColumnName("last_command_id");
            builder.Property(x => x.ActualState).HasColumnName("actual_state").HasMaxLength(40).IsRequired();
            builder.Property(x => x.ActualMediaAssetId).HasColumnName("actual_media_asset_id");
            builder.Property(x => x.ActualPlaylistId).HasColumnName("actual_playlist_id");
            builder.Property(x => x.ActualPlaylistIndex).HasColumnName("actual_playlist_index");
            builder.Property(x => x.ActualPositionSeconds).HasColumnName("actual_position_seconds");
            builder.Property(x => x.ActualDurationSeconds).HasColumnName("actual_duration_seconds");
            builder.Property(x => x.ActualReportedAt).HasColumnName("actual_reported_at");
            builder.Property(x => x.DriftMs).HasColumnName("drift_ms");
            builder.Property(x => x.Health).HasColumnName("health").HasMaxLength(40).IsRequired();
            builder.Property(x => x.UpdatedAt).HasColumnName("updated_at").IsRequired();
            builder.HasOne<Display>()
                .WithOne()
                .HasForeignKey<DisplayPlaybackState>(x => x.DisplayId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("fk_display_playback_states_displays_display_id");
        });
    }
}
