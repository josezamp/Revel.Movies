using System.Text.Json;

namespace RevelMovies.Application.Commands;

public sealed record PlayerCommand(
    int ProtocolVersion,
    Guid CommandId,
    string Type,
    DateTimeOffset IssuedAt,
    JsonElement? Payload);

public sealed record SendCommandRequest(string Type, JsonElement? Payload);
