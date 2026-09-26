using MHBuilder.SaveData;

namespace MHBuilder.Tests;

[Collection(CatalogCollection.Name)]
public sealed class SaveDataTests(CatalogFixture fixture)
{
    [Theory]
    [InlineData(0)]
    [InlineData(1024)]
    public void Short_files_are_not_saves(int length)
    {
        Assert.Throws<FormatException>(() => SaveDecryptor.Decrypt(new byte[length]));
    }

    [Fact]
    public void Misaligned_files_are_not_saves()
    {
        Assert.Throws<FormatException>(() => SaveDecryptor.Decrypt(new byte[SaveDecryptor.MinimumLength + 3]));
    }

    [Fact]
    public void Garbage_of_the_right_size_is_rejected_after_decrypting()
    {
        var data = new byte[(SaveDecryptor.MinimumLength + 7) / 8 * 8];
        new Random(1).NextBytes(data);

        SaveDecryptor.Decrypt(data);
        Assert.Throws<FormatException>(() => DecorationSaveReader.Read(data, fixture.Catalog));
    }

    [Fact]
    public void Local_save_lookup_never_throws()
    {
        var saves = LocalSaves.Find();
        Assert.All(saves, s => Assert.True(File.Exists(s.Path)));
    }
}
