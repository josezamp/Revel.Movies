using Microsoft.EntityFrameworkCore;
using RevelMovies.Domain.Displays;
using RevelMovies.Domain.Media;
using RevelMovies.Domain.Pairing;
using RevelEvent = RevelMovies.Domain.Events.Event;

namespace RevelMovies.Infrastructure.Persistence;

public sealed class RevelMoviesDbContext(DbContextOptions<RevelMoviesDbContext> options) : DbContext(options)
{
    public DbSet<RevelEvent> Events => Set<RevelEvent>();
    public DbSet<Display> Displays => Set<Display>();
    public DbSet<PairingSession> PairingSessions => Set<PairingSession>();
    public DbSet<MediaAsset> MediaAssets => Set<MediaAsset>();

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
    }
}
