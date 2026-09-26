namespace MHBuilder.Catalog;

/// <summary>
/// Skill picker groups aligned with MHOTOMO / GameCat:
/// Attack / Defense / Resist / Weapon / Explore / Item / Set (+ Affinity/Element/Status splits).
/// "Set" = skills mainly from armor set bonuses (series skills), not normal jewels.
/// </summary>
public static class SkillCategories
{
    public static readonly string[] Order =
    [
        "Affinity",
        "Attack",
        "Element",
        "Status",
        "Defense",
        "Resist",
        "Survival",
        "Weapon",
        "Ranged",
        "Explore",
        "Item",
        "Set",
        "Other",
    ];

    /// <summary>Skills granted primarily by set bonuses (series skills), incl. Secrets.</summary>
    private static readonly HashSet<string> Set = new(StringComparer.OrdinalIgnoreCase)
    {
        "Critical Element", "Critical Status", "True Critical Element", "True Critical Status",
        "Mind's Eye/Ballistics", "Protective Polish", "Razor Sharp/Spare Shot", "Guard Up",
        "Guts", "Hasten Recovery", "Non-elemental Boost", "Bludgeoner", "Bow Charge Plus",
        "Adrenaline", "Master's Touch",
    };

    private static readonly HashSet<string> Affinity = new(StringComparer.OrdinalIgnoreCase)
    {
        "Critical Eye", "Critical Boost", "Weakness Exploit", "Critical Draw", "Maximum Might",
        "Latent Power", "Affinity Sliding", "Agitator",
    };

    private static readonly HashSet<string> Attack = new(StringComparer.OrdinalIgnoreCase)
    {
        "Attack Boost", "Agitator", "Peak Performance", "Resentment", "Heroics", "Fortify",
        "Punishing Draw",
    };

    private static readonly HashSet<string> Element = new(StringComparer.OrdinalIgnoreCase)
    {
        "Fire Attack", "Water Attack", "Thunder Attack", "Ice Attack", "Dragon Attack",
        "Free Elem/Ammo Up", "Elderseal Boost",
    };

    private static readonly HashSet<string> Status = new(StringComparer.OrdinalIgnoreCase)
    {
        "Poison Attack", "Paralysis Attack", "Sleep Attack", "Blast Attack",
        "Slugger", "Stamina Thief", "Poison Functionality", "Para Functionality",
        "Sleep Functionality", "Blast Functionality",
    };

    private static readonly HashSet<string> Defense = new(StringComparer.OrdinalIgnoreCase)
    {
        "Defense Boost", "Divine Blessing", "Iron Skin", "Guard", "Offensive Guard",
        "Evade Window", "Evade Extender", "Quick Sheath", "Stun Resistance",
    };

    private static readonly HashSet<string> Resist = new(StringComparer.OrdinalIgnoreCase)
    {
        "Fire Resistance", "Water Resistance", "Thunder Resistance", "Ice Resistance", "Dragon Resistance",
        "Poison Resistance", "Paralysis Resistance", "Sleep Resistance", "Blast Resistance",
        "Bleeding Resistance", "Effluvia Resistance", "Blight Resistance", "Heat Guard",
        "Muck Resistance", "Tremor Resistance", "Earplugs", "Windproof",
    };

    private static readonly HashSet<string> Survival = new(StringComparer.OrdinalIgnoreCase)
    {
        "Health Boost", "Recovery Up", "Recovery Speed", "Constitution", "Marathon Runner",
        "Stamina Surge", "Hunger Resistance", "Coalescence", "Resuscitate",
    };

    private static readonly HashSet<string> Weapon = new(StringComparer.OrdinalIgnoreCase)
    {
        "Handicraft", "Speed Sharpening", "Focus", "Power Prolonger", "Partbreaker",
        "Horn Maestro", "Capacity Boost", "Artillery",
    };

    private static readonly HashSet<string> Ranged = new(StringComparer.OrdinalIgnoreCase)
    {
        "Normal Shots", "Piercing Shots", "Spread/Power Shots", "Special Ammo Boost",
        "Slinger Capacity",
    };

    /// <summary>MHOTOMO "Explore" — field / gathering / movement.</summary>
    private static readonly HashSet<string> Explore = new(StringComparer.OrdinalIgnoreCase)
    {
        "Scoutfly Range Up", "Scholar", "Botanist", "Master Gatherer", "Master Fisher",
        "Master Mounter", "Pro Transporter", "Honey Hunter", "Entomologist", "Dungmaster",
        "Effluvial Expert", "Blindsider", "Detector", "Forager's Luck", "BBQ Master",
        "Leap of Faith", "Airborne", "Jump Master", "Cliffhanger", "Speed Crawler",
        "Carving Pro", "Geologist",
    };

    /// <summary>MHOTOMO "Item" — item / healing / support consumables.</summary>
    private static readonly HashSet<string> Item = new(StringComparer.OrdinalIgnoreCase)
    {
        "Wide-Range", "Speed Eating", "Item Prolonger", "Free Meal", "Mushroomancer",
        "Bombardier", "Tool Specialist",
    };

    public static bool IsSetSkill(string name) => Set.Contains(name);

    /// <summary>Primary category (first match). Prefer <see cref="ClassifyAll"/> for the picker.</summary>
    public static string Classify(string name) => ClassifyAll(name, includeSetTab: false)[0];

    /// <summary>
    /// All tabs a skill should appear under. A skill can be in Attack and Affinity, etc.
    /// When <paramref name="includeSetTab"/> is true, also lists under Set (e.g. has a Secret / set grant).
    /// </summary>
    public static IReadOnlyList<string> ClassifyAll(string name, bool includeSetTab = false)
    {
        var list = new List<string>(4);
        void Add(string cat)
        {
            if (!list.Contains(cat)) list.Add(cat);
        }

        bool setOnly = Set.Contains(name);

        if (Affinity.Contains(name)) Add("Affinity");
        if (Attack.Contains(name)) Add("Attack");
        if (Element.Contains(name) || name.EndsWith(" Attack", StringComparison.OrdinalIgnoreCase))
        {
            if (name.Contains("Poison", StringComparison.OrdinalIgnoreCase)
                || name.Contains("Para", StringComparison.OrdinalIgnoreCase)
                || name.Contains("Sleep", StringComparison.OrdinalIgnoreCase)
                || name.Contains("Blast", StringComparison.OrdinalIgnoreCase))
                Add("Status");
            else
                Add("Element");
        }
        if (Status.Contains(name)) Add("Status");
        if (Defense.Contains(name)) Add("Defense");
        if (Resist.Contains(name) || name.EndsWith(" Resistance", StringComparison.OrdinalIgnoreCase)
            || name.EndsWith("proof", StringComparison.OrdinalIgnoreCase)
            || name is "Earplugs" or "Windproof" or "Heat Guard")
            Add("Resist");
        if (Survival.Contains(name)) Add("Survival");
        if (Weapon.Contains(name)) Add("Weapon");
        if (Ranged.Contains(name) || name.Contains("Shot", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Ammo", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Bow", StringComparison.OrdinalIgnoreCase))
            Add("Ranged");
        if (Explore.Contains(name)) Add("Explore");
        if (Item.Contains(name)) Add("Item");

        if (setOnly || includeSetTab)
            Add("Set");

        if (list.Count == 0)
            Add("Other");

        return Order.Where(list.Contains).Concat(list.Where(c => !Order.Contains(c))).ToList();
    }
}
