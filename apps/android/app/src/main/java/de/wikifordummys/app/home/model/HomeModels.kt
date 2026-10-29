package de.wikifordummys.app.home.model

import kotlinx.serialization.Serializable

/** Ausschnitt aus `MeDto` (packages/shared/src/index.ts), Antwort von `GET /api/v1/me`. */
@Serializable
data class Me(
    val id: String,
    val email: String,
    val displayName: String,
)

/** Ausschnitt aus `SpaceDto` (packages/shared/src/index.ts, SpacesService.toDto), Antwort von `GET /api/v1/spaces`. */
@Serializable
data class Space(
    val id: String,
    val key: String,
    val name: String,
    val description: String = "",
    /** `active` oder `archived` */
    val status: String,
    val homePageId: String? = null,
    /** `admin`, `editor` oder `viewer` */
    val role: String,
    val canEdit: Boolean = false,
)
