using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using FFmpeg.NET;
using FFmpeg.NET.Enums;
using RevelMovies.Application.Media;

namespace RevelMovies.Infrastructure.Media;

public sealed class FFmpegTvVideoOptimizer(TvOptimizationOptions options) : ITvVideoOptimizer
{
    public bool IsAvailable => options.Enabled && ResolveExecutable(options.FFmpegPath) is not null
        && ResolveExecutable(options.FFprobePath) is not null;

    public async Task<VideoDetails> OptimizeAsync(string inputPath, string outputPath, Action<double> progress,
        CancellationToken cancellationToken)
    {
        var executable = ResolveExecutable(options.FFmpegPath);
        if (!IsAvailable || executable is null)
            throw new VideoOptimizationException("La optimización para TV no está configurada en el servidor.");
        var source = await ProbeAsync(inputPath, cancellationToken);
        var fps = Math.Min(30, source.FramesPerSecond).ToString("0.########", CultureInfo.InvariantCulture);
        // FFmpeg autorotates before filtering. Normalize sample aspect ratio, then fit either orientation.
        var filters = "scale=w='max(2,trunc(iw*sar/2)*2)':h=ih,setsar=1," +
            "scale=w='min(iw,if(gte(iw,ih),1920,1080))':h='min(ih,if(gte(iw,ih),1080,1920))':" +
            $"force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps={fps}";
        var conversion = new ConversionOptions
        {
            VideoCodec = VideoCodec.libx264,
            VideoCodecPreset = VideoCodecPreset.fast,
            VideoCodecProfile = VideoCodecProfile.main,
            PixelFormat = "yuv420p", RemoveAudio = true, MapMetadata = false,
            Threads = Math.Clamp(options.Threads, 1, 16),
            ExtraArguments = $"-map 0:V:0 -sn -dn -map_metadata -1 -map_chapters -1 -crf 24 " +
                $"-maxrate 5M -bufsize 10M -level:v 4.0 -threads {Math.Clamp(options.Threads, 1, 16)} " +
                $"-filter_threads 1 -movflags +faststart -vf \"{filters}\""
        };
        var engine = new Engine(executable);
        Exception? failure = null;
        double lastProgress = 0;
        // xFFmpeg.NET reports non-zero exit codes through Error, not necessarily through the returned Task.
        engine.Error += (_, e) => failure = e.Exception;
        engine.Progress += (_, e) => Volatile.Write(ref lastProgress,
            Math.Clamp(e.ProcessedDuration.TotalSeconds / source.DurationSeconds, 0, .99));
        using var conversionCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var conversionTask = engine.ConvertAsync(new InputFile(inputPath), new OutputFile(outputPath), conversion, conversionCancellation.Token);
        try
        {
            // Report outside the stderr callback: cancelling there can deadlock the wrapper's stream-draining exit handler.
            // Keep reporting in this awaited scope so callbacks cannot outlive the conversion or its caller.
            while (await Task.WhenAny(conversionTask, Task.Delay(100, conversionCancellation.Token)) != conversionTask)
            {
                conversionCancellation.Token.ThrowIfCancellationRequested();
                progress(Volatile.Read(ref lastProgress));
            }
            await conversionTask;
        }
        catch
        {
            await conversionCancellation.CancelAsync();
            try { await conversionTask; } catch { /* Preserve the first failure. */ }
            // The wrapper calls Process.Kill without waiting for exit. Windows may still hold the media handles.
            await WaitForFileReleaseAsync(inputPath, outputPath);
            throw;
        }
        cancellationToken.ThrowIfCancellationRequested();
        if (failure is not null) throw new InvalidOperationException("FFmpeg could not convert the video.", failure);
        if (!File.Exists(outputPath) || new FileInfo(outputPath).Length == 0)
            throw new VideoOptimizationException("FFmpeg no generó un video válido.");
        var result = await ProbeAsync(outputPath, cancellationToken);
        if (result.Codec != "h264" || result.PixelFormat != "yuv420p" || result.HasAudio ||
            result.FramesPerSecond > 30.01 || Math.Max(result.Width, result.Height) > 1920 ||
            Math.Min(result.Width, result.Height) > 1080 ||
            Math.Abs(result.DurationSeconds - source.DurationSeconds) > Math.Max(.5, 2 / result.FramesPerSecond))
            throw new VideoOptimizationException("La copia generada no pasó la validación del perfil TV.");
        return result;
    }

    public async Task<VideoDetails> ProbeAsync(string path, CancellationToken cancellationToken)
    {
        var start = new ProcessStartInfo(ResolveExecutable(options.FFprobePath)
            ?? throw new VideoOptimizationException("No se encontró FFprobe en el servidor."))
        { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var argument in new[] { "-v", "error", "-show_streams", "-show_format", "-of", "json", path })
            start.ArgumentList.Add(argument);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start FFprobe.");
        try
        {
            var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var error = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            await error;
            if (process.ExitCode != 0) throw new VideoOptimizationException("No se pudo analizar el video. Verificá que el MP4 sea válido.");
            using var json = JsonDocument.Parse(await output);
            var streams = json.RootElement.GetProperty("streams").EnumerateArray().ToArray();
            var video = streams.FirstOrDefault(x => Text(x, "codec_type") == "video" &&
                !(x.TryGetProperty("disposition", out var disposition) && disposition.TryGetProperty("attached_pic", out var attached) && attached.GetInt32() == 1));
            if (video.ValueKind == JsonValueKind.Undefined)
                throw new VideoOptimizationException("El archivo no contiene una pista de video.");
            if (Text(video, "color_transfer") is "smpte2084" or "arib-std-b67")
                throw new VideoOptimizationException("Este video es HDR. Exportalo en SDR antes de optimizarlo para TV.");
            var durationText = Text(video, "duration") ?? (json.RootElement.TryGetProperty("format", out var format) ? Text(format, "duration") : null);
            double.TryParse(durationText, NumberStyles.Float, CultureInfo.InvariantCulture, out var duration);
            var fps = Rate(Text(video, "avg_frame_rate"));
            if (fps <= 0) fps = Rate(Text(video, "r_frame_rate"));
            var width = video.TryGetProperty("width", out var w) ? w.GetInt32() : 0;
            var height = video.TryGetProperty("height", out var h) ? h.GetInt32() : 0;
            if (!double.IsFinite(duration) || duration <= 0 || !double.IsFinite(fps) || fps <= 0 || width < 2 || height < 2)
                throw new VideoOptimizationException("No se pudo determinar la duración, resolución o FPS del video.");
            return new(width, height, duration, fps, streams.Any(x => Text(x, "codec_type") == "audio"),
                Text(video, "codec_name") ?? "", Text(video, "pix_fmt") ?? "");
        }
        finally
        {
            if (!process.HasExited) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(CancellationToken.None); }
        }
    }

    private static string? Text(JsonElement element, string name) => element.TryGetProperty(name, out var value) ? value.GetString() : null;
    private static async Task WaitForFileReleaseAsync(params string[] paths)
    {
        if (!OperatingSystem.IsWindows()) return;
        var deadline = Stopwatch.StartNew();
        while (true)
        {
            try
            {
                foreach (var path in paths)
                    if (File.Exists(path)) { using var handle = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.None); }
                return;
            }
            catch (IOException) when (deadline.Elapsed < TimeSpan.FromSeconds(5)) { await Task.Delay(25); }
        }
    }
    private static double Rate(string? value)
    {
        var parts = (value ?? "").Split('/');
        if (!double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var numerator)) return 0;
        return parts.Length == 2 && double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var denominator)
            ? denominator > 0 ? numerator / denominator : 0 : numerator;
    }

    private static string? ResolveExecutable(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (Path.IsPathFullyQualified(value)) return File.Exists(value) ? value : null;
        // Only bare executable names are looked up on PATH; relative configured paths are ambiguous under IIS.
        if (Path.GetFileName(value) != value) return null;
        var name = OperatingSystem.IsWindows() && !value.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? value + ".exe" : value;
        return (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)
            .Where(directory => !string.IsNullOrWhiteSpace(directory))
            .Select(directory => Path.Combine(directory.Trim('"'), name)).FirstOrDefault(File.Exists);
    }
}
