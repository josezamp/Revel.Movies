using System.Diagnostics;
using System.Security.Cryptography;
using RevelMovies.Application.Media;
using RevelMovies.Infrastructure.Media;
using Xunit;

namespace RevelMovies.Api.Tests;

public sealed class FFmpegTvVideoOptimizerTests
{
    private static TvOptimizationOptions Options => new()
    {
        Enabled = true, FFmpegPath = Environment.GetEnvironmentVariable("REVEL_TEST_FFMPEG") ?? "ffmpeg",
        FFprobePath = Environment.GetEnvironmentVariable("REVEL_TEST_FFPROBE") ?? "ffprobe"
    };

    public sealed class FFmpegTheoryAttribute : TheoryAttribute
    {
        public FFmpegTheoryAttribute()
        {
            if (!new FFmpegTvVideoOptimizer(Options).IsAvailable)
                Skip = "Install FFmpeg/FFprobe on PATH or set REVEL_TEST_FFMPEG and REVEL_TEST_FFPROBE to run real encoder tests.";
        }
    }

    [FFmpegTheory]
    [InlineData("2560x1440", "60", false, 1920, 1080, 30)]
    [InlineData("360x640", "24000/1001", false, 360, 640, 23.976)]
    [InlineData("640x360", "25", true, 360, 640, 25)]
    public async Task Real_conversion_preserves_source_and_orientation_and_limits_resolution_fps_and_audio(
        string size, string rate, bool rotate, int width, int height, double fps)
    {
        var root = Path.Combine(Path.GetTempPath(), "revel-encoder-test-" + Guid.NewGuid()); Directory.CreateDirectory(root);
        try
        {
            var input = Path.Combine(root, "original with spaces.mp4"); var output = Path.Combine(root, "tv copy.mp4");
            await GenerateAsync(input, size, rate);
            if (rotate)
            {
                var rotated = Path.Combine(root, "rotated.mp4");
                await RunFFmpegAsync("-display_rotation:v:0", "90", "-i", input, "-c", "copy", rotated);
                File.Move(rotated, input, true);
            }
            var originalHash = SHA256.HashData(await File.ReadAllBytesAsync(input));
            var optimizer = new FFmpegTvVideoOptimizer(Options);
            var details = await optimizer.OptimizeAsync(input, output, _ => { }, default);
            Assert.Equal(width, details.Width); Assert.Equal(height, details.Height);
            Assert.InRange(details.FramesPerSecond, fps - .01, fps + .01);
            Assert.Equal("h264", details.Codec); Assert.Equal("yuv420p", details.PixelFormat); Assert.False(details.HasAudio);
            Assert.InRange(details.DurationSeconds, 1, 1.6);
            Assert.Equal(originalHash, SHA256.HashData(await File.ReadAllBytesAsync(input)));
            Assert.True(new FileInfo(output).Length < new FileInfo(input).Length);
        }
        finally { Directory.Delete(root, true); }
    }

    [FFmpegTheory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Real_encoder_failure_or_cancellation_cannot_report_success(bool cancel)
    {
        var root = Path.Combine(Path.GetTempPath(), "revel-encoder-test-" + Guid.NewGuid()); Directory.CreateDirectory(root);
        try
        {
            var input = Path.Combine(root, "original.mp4"); await GenerateAsync(input, "1280x720", "60");
            var optimizer = new FFmpegTvVideoOptimizer(Options);
            if (cancel)
            {
                using var cancellation = new CancellationTokenSource();
                await Assert.ThrowsAnyAsync<OperationCanceledException>(() => optimizer.OptimizeAsync(input,
                    Path.Combine(root, "cancelled.mp4"), _ => cancellation.Cancel(), cancellation.Token));
            }
            else
            {
                var error = await Assert.ThrowsAsync<InvalidOperationException>(() => optimizer.OptimizeAsync(input,
                    Path.Combine(root, "invalid-output-extension.xyz"), _ => { }, default));
                Assert.NotNull(error.InnerException);
            }
            Assert.True(File.Exists(input));
        }
        finally { Directory.Delete(root, true); }
    }

    private static Task GenerateAsync(string path, string size, string fps) => RunFFmpegAsync("-f", "lavfi", "-i",
        $"testsrc2=size={size}:rate={fps}", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
        "-t", "1.4", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "8", "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", path);

    private static async Task RunFFmpegAsync(params string[] arguments)
    {
        var start = new ProcessStartInfo(Options.FFmpegPath)
            { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true };
        foreach (var arg in new[] { "-hide_banner", "-loglevel", "error", "-y" }.Concat(arguments)) start.ArgumentList.Add(arg);
        using var process = Process.Start(start)!;
        var error = process.StandardError.ReadToEndAsync(); var output = process.StandardOutput.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        try { await process.WaitForExitAsync(timeout.Token); }
        finally { if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(); } }
        await output;
        Assert.True(process.ExitCode == 0, await error);
    }
}
