using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Claudio.Api.Migrations
{
    [DbContext(typeof(Claudio.Api.Data.AppDbContext))]
    [Migration("20260419164000_FixDesktopRefreshTokenIdentity")]
    public partial class FixDesktopRefreshTokenIdentity : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            if (!ActiveProvider.Contains("Npgsql"))
                return;

            migrationBuilder.Sql(
                """
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM information_schema.tables
                        WHERE table_schema = 'public' AND table_name = 'DesktopRefreshTokens'
                    ) THEN
                        CREATE SEQUENCE IF NOT EXISTS "DesktopRefreshTokens_Id_seq";

                        ALTER SEQUENCE "DesktopRefreshTokens_Id_seq"
                            OWNED BY "DesktopRefreshTokens"."Id";

                        ALTER TABLE "DesktopRefreshTokens"
                            ALTER COLUMN "Id" SET DEFAULT nextval('"DesktopRefreshTokens_Id_seq"'::regclass);

                        PERFORM setval(
                            '"DesktopRefreshTokens_Id_seq"',
                            GREATEST(COALESCE((SELECT MAX("Id") FROM "DesktopRefreshTokens"), 0), 1),
                            (SELECT COUNT(*) > 0 FROM "DesktopRefreshTokens")
                        );
                    END IF;
                END $$;
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            if (!ActiveProvider.Contains("Npgsql"))
                return;

            migrationBuilder.Sql(
                """
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM information_schema.tables
                        WHERE table_schema = 'public' AND table_name = 'DesktopRefreshTokens'
                    ) THEN
                        ALTER TABLE "DesktopRefreshTokens"
                            ALTER COLUMN "Id" DROP DEFAULT;
                    END IF;
                END $$;
                """);
        }
    }
}
