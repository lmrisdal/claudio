use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Users::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Users::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(Users::Username)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(ColumnDef::new(Users::PasswordHash).string())
                    .col(ColumnDef::new(Users::Email).string())
                    .col(
                        ColumnDef::new(Users::Role)
                            .string()
                            .not_null()
                            .default("user"),
                    )
                    .col(
                        ColumnDef::new(Users::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(UserExternalLogins::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(UserExternalLogins::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(UserExternalLogins::UserId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(UserExternalLogins::Provider)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(UserExternalLogins::ProviderKey)
                            .string()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(UserExternalLogins::Table, UserExternalLogins::UserId)
                            .to(Users::Table, Users::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(Games::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Games::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Games::Title).string().not_null())
                    .col(ColumnDef::new(Games::Platform).string().not_null())
                    .col(ColumnDef::new(Games::FolderName).string().not_null())
                    .col(ColumnDef::new(Games::FolderPath).string().not_null())
                    .col(
                        ColumnDef::new(Games::InstallType)
                            .string()
                            .not_null()
                            .default("portable"),
                    )
                    .col(ColumnDef::new(Games::Summary).string())
                    .col(ColumnDef::new(Games::Genre).string())
                    .col(ColumnDef::new(Games::ReleaseYear).integer())
                    .col(ColumnDef::new(Games::CoverUrl).string())
                    .col(ColumnDef::new(Games::HeroUrl).string())
                    .col(ColumnDef::new(Games::IgdbId).big_integer())
                    .col(ColumnDef::new(Games::IgdbSlug).string())
                    .col(
                        ColumnDef::new(Games::SizeBytes)
                            .big_integer()
                            .not_null()
                            .default(0i64),
                    )
                    .col(
                        ColumnDef::new(Games::IsMissing)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(Games::InstallerExe).string())
                    .col(ColumnDef::new(Games::GameExe).string())
                    .col(ColumnDef::new(Games::Developer).string())
                    .col(ColumnDef::new(Games::Publisher).string())
                    .col(ColumnDef::new(Games::GameMode).string())
                    .col(ColumnDef::new(Games::Series).string())
                    .col(ColumnDef::new(Games::Franchise).string())
                    .col(ColumnDef::new(Games::GameEngine).string())
                    .col(
                        ColumnDef::new(Games::IsProcessing)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .table(Games::Table)
                    .col(Games::Platform)
                    .col(Games::FolderName)
                    .unique()
                    .name("idx_games_platform_folder_name")
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(RefreshTokens::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(RefreshTokens::TokenHash)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(RefreshTokens::UserId).integer().not_null())
                    .col(
                        ColumnDef::new(RefreshTokens::ExpiresAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(RefreshTokens::Table, RefreshTokens::UserId)
                            .to(Users::Table, Users::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(RefreshTokens::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Games::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(UserExternalLogins::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Users::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Users {
    Table,
    Id,
    Username,
    PasswordHash,
    Email,
    Role,
    CreatedAt,
}

#[derive(DeriveIden)]
enum UserExternalLogins {
    Table,
    Id,
    UserId,
    Provider,
    ProviderKey,
}

#[derive(DeriveIden)]
enum Games {
    Table,
    Id,
    Title,
    Platform,
    FolderName,
    FolderPath,
    InstallType,
    Summary,
    Genre,
    ReleaseYear,
    CoverUrl,
    HeroUrl,
    IgdbId,
    IgdbSlug,
    SizeBytes,
    IsMissing,
    InstallerExe,
    GameExe,
    Developer,
    Publisher,
    GameMode,
    Series,
    Franchise,
    GameEngine,
    IsProcessing,
}

#[derive(DeriveIden)]
enum RefreshTokens {
    Table,
    TokenHash,
    UserId,
    ExpiresAt,
}
