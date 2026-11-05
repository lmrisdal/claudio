using System;
using Claudio.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Claudio.Api.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20261105000000_AddMetadataAttemptTimestamps")]
    public partial class AddMetadataAttemptTimestamps : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "IgdbAttemptedAt",
                table: "Games",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "HeroAttemptedAt",
                table: "Games",
                type: "timestamp with time zone",
                nullable: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "IgdbAttemptedAt", table: "Games");
            migrationBuilder.DropColumn(name: "HeroAttemptedAt", table: "Games");
        }
    }
}
