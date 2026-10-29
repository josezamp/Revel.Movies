namespace RevelMovies.Infrastructure.Media;

public sealed class TvOptimizationOptions
{
    public bool Enabled { get; set; }
    public string FFmpegPath { get; set; } = "ffmpeg";
    public string FFprobePath { get; set; } = "ffprobe";
    public string WorkPath { get; set; } = Path.Combine(Path.GetTempPath(), "revel-tv-optimization");
    public int TimeoutMinutes { get; set; } = 30;
    public int Threads { get; set; } = 2;
}
