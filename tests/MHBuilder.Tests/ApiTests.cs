using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace MHBuilder.Tests;

public sealed class ApiTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<JsonElement> GetJson(string url)
    {
        var response = await _client.GetAsync(url);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private async Task<int> SkillId(string name)
    {
        var skills = await GetJson("/api/skills");
        return skills.EnumerateArray().First(s => s.GetProperty("name").GetString() == name).GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task Health_and_ui_are_served()
    {
        Assert.Equal("ok", await _client.GetStringAsync("/healthz"));
        var html = await _client.GetStringAsync("/");
        Assert.Contains("MHBuilder", html);
        Assert.Contains("favicon.svg", html);
    }

    [Fact]
    public async Task Meta_reports_catalog_counts_only()
    {
        var meta = await GetJson("/api/meta");
        Assert.True(meta.GetProperty("armor").GetInt32() > 1000);
        Assert.True(meta.GetProperty("decorations").GetInt32() > 300);
        Assert.False(meta.TryGetProperty("dataDir", out _));
        Assert.False(meta.TryGetProperty("savePath", out _));
    }

    [Fact]
    public async Task Catalog_lists_are_available()
    {
        Assert.True((await GetJson("/api/skills")).GetArrayLength() > 150);
        Assert.True((await GetJson("/api/decorations")).GetArrayLength() > 300);
        Assert.True((await GetJson("/api/charms")).GetArrayLength() > 100);
        Assert.Equal(20, (await GetJson("/api/armor?slot=head&limit=20")).GetArrayLength());
        Assert.NotEmpty((await GetJson("/api/weapons?q=Safi&limit=5")).EnumerateArray());
        Assert.True((await GetJson("/api/monsters")).GetProperty("monsters").GetArrayLength() > 70);
    }

    [Fact]
    public async Task Search_returns_sets_with_the_wanted_skills_and_their_materials()
    {
        int critEye = await SkillId("Critical Eye");
        var response = await _client.PostAsJsonAsync("/api/search", new
        {
            skills = new[] { new { id = critEye, level = 5 } },
            weaponSlots = new[] { 4, 2, 1 },
            maxResults = 10
        });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(10, body.GetProperty("count").GetInt32());
        Assert.False(body.GetProperty("timedOut").GetBoolean());
        var best = body.GetProperty("results")[0];
        var skill = best.GetProperty("skills").EnumerateArray().First(s => s.GetProperty("id").GetInt32() == critEye);
        Assert.True(skill.GetProperty("level").GetInt32() >= 5);

        var armorIds = new[] { "head", "chest", "gloves", "waist", "legs" }
            .Select(slot => best.GetProperty(slot).GetProperty("id").GetInt32())
            .ToArray();
        var materials = await _client.PostAsJsonAsync("/api/materials", new { armorIds });
        materials.EnsureSuccessStatusCode();
        var mats = await materials.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(5, mats.GetProperty("pieces").GetArrayLength());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Limited_decorations_with_an_empty_list_uses_no_jewels(bool sendEmptyList)
    {
        var skills = new[] { new { id = await SkillId("Critical Eye"), level = 5 }, new { id = await SkillId("Weakness Exploit"), level = 3 } };

        async Task<List<JsonElement>> Search(object request)
        {
            var response = await _client.PostAsJsonAsync("/api/search", request);
            response.EnsureSuccessStatusCode();
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            return body.GetProperty("results").EnumerateArray().ToList();
        }
        static int Jewels(JsonElement r) => r.GetProperty("decorations").GetArrayLength();

        var unlimited = await Search(new { skills, maxResults = 10 });
        Assert.Contains(unlimited, r => Jewels(r) > 0);

        var limited = await Search(sendEmptyList
            ? new { skills, unlimitedDecorations = false, ownedDecorations = Array.Empty<object>(), maxResults = 10 }
            : new { skills, unlimitedDecorations = false, maxResults = 10 });
        Assert.All(limited, r => Assert.Equal(0, Jewels(r)));
    }

    [Fact]
    public async Task Search_without_skills_is_a_bad_request()
    {
        var response = await _client.PostAsJsonAsync("/api/search", new { skills = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(string.IsNullOrEmpty(body.GetProperty("error").GetString()));
    }

    [Fact]
    public async Task Uploading_a_non_save_is_a_bad_request()
    {
        var response = await _client.PostAsync("/api/save/decorations", new ByteArrayContent(new byte[4096]));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
