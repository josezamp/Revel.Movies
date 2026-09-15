using Microsoft.EntityFrameworkCore;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;
using RevelMovies.Domain.Displays;
using RevelMovies.Domain.Events;
using RevelMovies.Domain.Pairing;
using RevelEvent = RevelMovies.Domain.Events.Event;

namespace RevelMovies.Infrastructure.Persistence;

public sealed class RevelMoviesDbContext(DbContextOptions<RevelMoviesDbContext> options) : DbContext(options)
{
    public DbSet<RevelEvent> Events => Set<RevelEvent>();
    public DbSet<Display> Displays => Set<Display>();
    public DbSet<PairingSession> PairingSessions => Set<PairingSession>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder
            .HasAnnotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn)
            .HasAnnotation("Relational:MaxIdentifierLength", 63);

        modelBuilder.Entity<RevelEvent>(builder =>
        {
            builder.ToTable("events");
            builder.HasKey(x => x.Id).HasName("pk_events");
            builder.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid").ValueGeneratedNever();
            builder.Property(x => x.Name).HasColumnName("name").HasColumnType("character varying(200)").HasMaxLength(200).IsRequired();
            builder.Property(x => x.Slug).HasColumnName("slug").HasColumnType("character varying(200)").HasMaxLength(200).IsRequired();
            builder.Property(x => x.StartsAt).HasColumnName("starts_at").HasColumnType("timestamp with time zone");
            builder.Property(x => x.EndsAt).HasColumnName("ends_at").HasColumnType("timestamp with time zone");
            builder.Property(x => x.TimeZone).HasColumnName("time_zone").HasColumnType("character varying(100)").HasMaxLength(100).IsRequired();
            builder.Property(x => x.Status).HasColumnName("status").HasColumnType("integer").IsRequired();
            builder.Property(x => x.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp with time zone").IsRequired();
            builder.Property(x => x.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp with time zone").IsRequired();
            builder.HasIndex(x => x.Slug).IsUnique().HasDatabaseName("ux_events_slug");
        });

        modelBuilder.Entity<Display>(builder =>
        {
            builder.ToTable("displays");
            builder.HasKey(x => x.Id).HasName("pk_displays");
            builder.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid").ValueGeneratedNever();
            builder.Property(x => x.EventId).HasColumnName("event_id").HasColumnType("uuid").IsRequired();
            builder.Property(x => x.Name).HasColumnName("name").HasColumnType("character varying(200)").HasMaxLength(200).IsRequired();
            builder.Property(x => x.DeviceTokenHash).HasColumnName("device_token_hash").HasColumnType("character varying(64)").HasMaxLength(64).IsRequired();
            builder.Property(x => x.Status).HasColumnName("status").HasColumnType("integer").IsRequired();
            builder.Property(x => x.LastSeenAt).HasColumnName("last_seen_at").HasColumnType("timestamp with time zone");
            builder.Property(x => x.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp with time zone").IsRequired();
            builder.Property(x => x.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp with time zone").IsRequired();
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
            builder.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid").ValueGeneratedNever();
            builder.Property(x => x.SessionToken).HasColumnName("session_token").HasColumnType("character varying(64)").HasMaxLength(64).IsRequired();
            builder.Property(x => x.Code).HasColumnName("code").HasColumnType("character varying(6)").HasMaxLength(6).IsRequired();
            builder.Property(x => x.CreatedAt).HasColumnName("created_at").HasColumnType("timestamp with time zone").IsRequired();
            builder.Property(x => x.ExpiresAt).HasColumnName("expires_at").HasColumnType("timestamp with time zone").IsRequired();
            builder.Property(x => x.DisplayId).HasColumnName("display_id").HasColumnType("uuid");
            builder.Property(x => x.DeviceToken).HasColumnName("device_token").HasColumnType("character varying(128)").HasMaxLength(128);
            builder.Property(x => x.PairedAt).HasColumnName("paired_at").HasColumnType("timestamp with time zone");
            builder.Ignore(x => x.IsPaired);
            builder.HasIndex(x => x.SessionToken).IsUnique().HasDatabaseName("ux_pairing_sessions_session_token");
            builder.HasIndex(x => x.Code).HasDatabaseName("ix_pairing_sessions_code");
        });
    }
}
