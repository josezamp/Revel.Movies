namespace RevelMovies.Application.Media;

public interface ITvVideoOptimizer
{
    bool IsAvailable { get; }
    Task<VideoDetails> OptimizeAsync(string inputPath, string outputPath, Action<double> progress,
        CancellationToken cancellationToken);
}

public sealed record VideoDetails(int Width, int Height, double DurationSeconds, double FramesPerSecond,
    bool HasAudio, string Codec, string PixelFormat);

public sealed class VideoOptimizationException(string message) : Exception(message);
