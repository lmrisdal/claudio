using System;
using Claudio.Api.Data;
using Claudio.Api.Enums;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Claudio.Api.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260625000000_InitialCreate")]
    public partial class InitialCreate : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Games",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Title = table.Column<string>(type: "text", nullable: false),
                    Platform = table.Column<string>(type: "text", nullable: false),
                    FolderName = table.Column<string>(type: "text", nullable: false),
                    FolderPath = table.Column<string>(type: "text", nullable: false),
                    InstallType = table.Column<InstallType>(type: "integer", nullable: false),
                    Summary = table.Column<string>(type: "text", nullable: true),
                    Genre = table.Column<string>(type: "text", nullable: true),
                    ReleaseYear = table.Column<int>(type: "integer", nullable: true),
                    CoverUrl = table.Column<string>(type: "text", nullable: true),
                    HeroUrl = table.Column<string>(type: "text", nullable: true),
                    IgdbId = table.Column<long>(type: "bigint", nullable: true),
                    IgdbSlug = table.Column<string>(type: "text", nullable: true),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    IsMissing = table.Column<bool>(type: "boolean", nullable: false),
                    InstallerExe = table.Column<string>(type: "text", nullable: true),
                    GameExe = table.Column<string>(type: "text", nullable: true),
                    Developer = table.Column<string>(type: "text", nullable: true),
                    Publisher = table.Column<string>(type: "text", nullable: true),
                    GameMode = table.Column<string>(type: "text", nullable: true),
                    Series = table.Column<string>(type: "text", nullable: true),
                    Franchise = table.Column<string>(type: "text", nullable: true),
                    GameEngine = table.Column<string>(type: "text", nullable: true),
                    IsProcessing = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Games", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "AppPreferences",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PreferencesJson = table.Column<string>(type: "text", nullable: false, defaultValue: "{}"),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AppPreferences", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Games_Platform_FolderName",
                table: "Games",
                columns: new[] { "Platform", "FolderName" },
                unique: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "Games");
            migrationBuilder.DropTable(name: "AppPreferences");
        }
    }
}
