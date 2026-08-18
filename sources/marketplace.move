/// Secure Social Commerce Platform on Sui
module sui_commerce::marketplace {
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use std::string::{Self, String};
    use std::vector;
    use sui::clock::{Self, Clock};
    use sui::dynamic_field as df;
    use sui::bcs;
    use std::hash;

    // ======== Error Codes ========
    const ENotProductOwner: u64 = 0;
    const EInsufficientPayment: u64 = 1;
    const EProductNotForSale: u64 = 2;
    const EUnauthorized: u64 = 3;
    const EInvalidPrice: u64 = 4;
    const EInvalidRating: u64 = 5;
    const ESelfReview: u64 = 6;
    const EAlreadyReviewed: u64 = 7;
    const EPlatformFeeOverflow: u64 = 8;
    const EProductSoldOut: u64 = 9;
    const EInvalidQuantity: u64 = 10;
    const ENotTokenOwner: u64 = 11;
    const EAlreadyListedForResale: u64 = 12;
    const ENotListedForResale: u64 = 13;
    const ENotAdmin: u64 = 14;

    // ======== Constants ========
    const PLATFORM_FEE_BPS: u64 = 200;
    const ROYALTY_FEE_BPS: u64 = 250;
    const MAX_FEE_BPS: u64 = 10000;
    const MIN_RATING: u8 = 1;
    const MAX_RATING: u8 = 5;
    const MAX_DESCRIPTION_LENGTH: u64 = 1000;
    const MAX_REVIEW_LENGTH: u64 = 500;

    // ======== Core Structs ========

    public struct MARKETPLACE has drop {}

    public struct Platform has key {
        id: UID,
        admin: address,
        treasury: Balance<SUI>,
        total_sales: u64,
        total_products: u64,
        platform_fee_bps: u64,
    }

    public struct SellerProfile has key, store {
        id: UID,
        owner: address,
        display_name: String,
        total_sales: u64,
        total_reviews: u64,
        average_rating: u64,
        created_at: u64,
        is_verified: bool,
    }

    public struct Product has key, store {
        id: UID,
        seller: address,
        name: String,
        description: String,
        price: u64,
        quantity_available: u64,
        total_sold: u64,
        is_active: bool,
        created_at: u64,
        updated_at: u64,
        category: String,
        review_count: u64,
        total_rating_sum: u64,
        resellable: bool,
        file_cid: String,
        // License fields (feature branch only)
        license_type: u8,
        license_max_activations: u64,
        license_duration_days: u64,
        license_renewal_price: u64,
    }

    public struct Review has store, drop {
        reviewer: address,
        rating: u8,
        comment: String,
        timestamp: u64,
        verified_purchase: bool,
    }

    public struct PurchaseReceipt has key, store {
        id: UID,
        product_id: ID,
        buyer: address,
        seller: address,
        amount_paid: u64,
        platform_fee: u64,
        quantity: u64,
        timestamp: u64,
    }

    public struct BuyerBadge has key, store {
        id: UID,
        owner: address,
        total_purchases: u64,
        total_spent: u64,
        member_since: u64,
        tier: u8,
    }

    // ======== Resellable Product Structs ========

    public struct OwnershipToken has key, store {
        id: UID,
        original_product_id: ID,
        current_owner: address,
        previous_owner: address,
        original_seller: address,
        purchase_price: u64,
        purchase_timestamp: u64,
        is_listed_for_resale: bool,
        resale_price: u64,
        file_cid: String,
    }

    /// ✅ Token is stored INSIDE the listing — buyer never needs to own it
    public struct ResaleListing has key, store {
        id: UID,
        token: OwnershipToken,      // ← token lives here, not in seller's wallet
        seller: address,
        price: u64,
        original_product_id: ID,
        original_seller: address,
        listed_at: u64,
    }

    // ======== Events ========

    public struct ProductListed has copy, drop {
        product_id: ID,
        seller: address,
        price: u64,
        timestamp: u64,
    }

    public struct ProductPurchased has copy, drop {
        product_id: ID,
        buyer: address,
        seller: address,
        price: u64,
        quantity: u64,
        platform_fee: u64,
        timestamp: u64,
    }

    public struct ProductReviewed has copy, drop {
        product_id: ID,
        reviewer: address,
        rating: u8,
        timestamp: u64,
    }

    public struct SellerProfileCreated has copy, drop {
        seller: address,
        timestamp: u64,
    }

    public struct ResaleListed has copy, drop {
        listing_id: ID,
        token_id: ID,
        seller: address,
        price: u64,
        original_product_id: ID,
        timestamp: u64,
    }

    public struct ResalePurchased has copy, drop {
        token_id: ID,
        listing_id: ID,
        buyer: address,
        seller: address,
        price: u64,
        original_product_id: ID,
        timestamp: u64,
    }

    public struct ResaleDelisted has copy, drop {
        listing_id: ID,
        token_id: ID,
        seller: address,
        timestamp: u64,
    }

    // ======== License Structs ========
    // license_type: 0=none, 1=single-device, 2=multi-device, 3=subscription

    public struct SoftwareLicense has key, store {
        id: UID,
        product_id: ID,
        owner: address,
        license_key: vector<u8>,
        license_type: u8,
        max_activations: u64,
        activations_used: u64,
        activated_devices: vector<vector<u8>>,
        issued_at: u64,
        expires_at: u64,
        is_revoked: bool,
    }

    public struct LicenseIssued has copy, drop {
        license_id: ID,
        product_id: ID,
        owner: address,
        license_type: u8,
        expires_at: u64,
        timestamp: u64,
    }

    public struct LicenseActivated has copy, drop {
        license_id: ID,
        device_id: vector<u8>,
        activations_used: u64,
        timestamp: u64,
    }

    public struct LicenseRenewed has copy, drop {
        license_id: ID,
        new_expires_at: u64,
        timestamp: u64,
    }

    // ======== Initialization ========

    fun init(_witness: MARKETPLACE, ctx: &mut TxContext) {
        let platform = Platform {
            id: object::new(ctx),
            admin: tx_context::sender(ctx),
            treasury: balance::zero(),
            total_sales: 0,
            total_products: 0,
            platform_fee_bps: PLATFORM_FEE_BPS,
        };
        transfer::share_object(platform);
    }

    // ======== Seller Functions ========

    public entry fun create_seller_profile(
        display_name: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let profile = SellerProfile {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            display_name: string::utf8(display_name),
            total_sales: 0,
            total_reviews: 0,
            average_rating: 0,
            created_at: clock::timestamp_ms(clock),
            is_verified: false,
        };

        event::emit(SellerProfileCreated {
            seller: tx_context::sender(ctx),
            timestamp: clock::timestamp_ms(clock),
        });

        transfer::transfer(profile, tx_context::sender(ctx));
    }

    public entry fun list_product(
        platform: &mut Platform,
        name: vector<u8>,
        description: vector<u8>,
        price: u64,
        quantity: u64,
        category: vector<u8>,
        resellable: bool,
        file_cid: vector<u8>,
        license_type: u8,
        license_max_activations: u64,
        license_duration_days: u64,
        license_renewal_price: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(price > 0, EInvalidPrice);
        assert!(quantity > 0, EInvalidQuantity);
        assert!(vector::length(&description) <= MAX_DESCRIPTION_LENGTH, EInvalidQuantity);

        let product_id = object::new(ctx);
        let product_id_copy = object::uid_to_inner(&product_id);

        let product = Product {
            id: product_id,
            seller: tx_context::sender(ctx),
            name: string::utf8(name),
            description: string::utf8(description),
            price,
            quantity_available: quantity,
            total_sold: 0,
            is_active: true,
            created_at: clock::timestamp_ms(clock),
            updated_at: clock::timestamp_ms(clock),
            category: string::utf8(category),
            review_count: 0,
            total_rating_sum: 0,
            resellable,
            file_cid: string::utf8(file_cid),
            license_type,
            license_max_activations,
            license_duration_days,
            license_renewal_price,
        };

        platform.total_products = platform.total_products + 1;

        event::emit(ProductListed {
            product_id: product_id_copy,
            seller: tx_context::sender(ctx),
            price,
            timestamp: clock::timestamp_ms(clock),
        });

        transfer::share_object(product);
    }

    public entry fun update_product(
        product: &mut Product,
        new_price: u64,
        new_quantity: u64,
        new_description: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(product.seller == tx_context::sender(ctx), ENotProductOwner);
        assert!(new_price > 0, EInvalidPrice);
        assert!(vector::length(&new_description) <= MAX_DESCRIPTION_LENGTH, EInvalidQuantity);

        product.price = new_price;
        product.quantity_available = new_quantity;
        product.description = string::utf8(new_description);
        product.updated_at = clock::timestamp_ms(clock);
    }

    public entry fun deactivate_product(
        product: &mut Product,
        ctx: &mut TxContext
    ) {
        assert!(product.seller == tx_context::sender(ctx), ENotProductOwner);
        product.is_active = false;
    }

    // ======== Buyer Functions ========

    public entry fun purchase_product(
        platform: &mut Platform,
        product: &mut Product,
        payment: Coin<SUI>,
        quantity: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(product.is_active, EProductNotForSale);
        assert!(product.quantity_available >= quantity, EProductSoldOut);
        assert!(quantity > 0, EInvalidQuantity);

        let total_price = product.price * quantity;
        let payment_amount = coin::value(&payment);
        assert!(payment_amount == total_price, EInsufficientPayment);

        let platform_fee = calculate_fee(total_price, platform.platform_fee_bps);
        assert!(platform_fee <= total_price, EPlatformFeeOverflow);

        let mut payment_balance = coin::into_balance(payment);
        let fee_balance = balance::split(&mut payment_balance, platform_fee);

        balance::join(&mut platform.treasury, fee_balance);
        platform.total_sales = platform.total_sales + 1;

        let seller_coin = coin::from_balance(payment_balance, ctx);
        transfer::public_transfer(seller_coin, product.seller);

        product.quantity_available = product.quantity_available - quantity;
        product.total_sold = product.total_sold + quantity;

        if (product.quantity_available == 0) {
            product.is_active = false;
        };

        let buyer = tx_context::sender(ctx);

        // Timestamp used for license minting
        let now = clock::timestamp_ms(clock);

        // Issue ownership token for resellable products
        if (product.resellable) {
            let token = OwnershipToken {
                id: object::new(ctx),
                original_product_id: object::uid_to_inner(&product.id),
                current_owner: buyer,
                previous_owner: product.seller,
                original_seller: product.seller,
                purchase_price: total_price,
                purchase_timestamp: clock::timestamp_ms(clock),
                is_listed_for_resale: false,
                resale_price: 0,
                file_cid: product.file_cid,
            };
            transfer::transfer(token, buyer);
        };

        let receipt = PurchaseReceipt {
            id: object::new(ctx),
            product_id: object::uid_to_inner(&product.id),
            buyer,
            seller: product.seller,
            amount_paid: total_price,
            platform_fee,
            quantity,
            timestamp: clock::timestamp_ms(clock),
        };

        event::emit(ProductPurchased {
            product_id: object::uid_to_inner(&product.id),
            buyer,
            seller: product.seller,
            price: total_price,
            quantity,
            platform_fee,
            timestamp: clock::timestamp_ms(clock),
        });

        transfer::transfer(receipt, buyer);

        // ── Mint SoftwareLicense if product has licensing enabled ─────────
        if (product.license_type != 0) {
            // Generate a unique license key from tx digest + product id + buyer
            let tx_digest = tx_context::digest(ctx);
            let product_id_bytes = object::uid_to_bytes(&product.id);
            let buyer_bytes = bcs::to_bytes(&buyer);

            let mut key_seed: vector<u8> = vector::empty();
            vector::append(&mut key_seed, *tx_digest);
            vector::append(&mut key_seed, product_id_bytes);
            vector::append(&mut key_seed, buyer_bytes);
            let license_key = hash::sha3_256(key_seed);

            // Calculate expiry: 0 = lifetime, otherwise now + days * ms_per_day
            let expires_at = if (product.license_duration_days == 0) {
                0
            } else {
                let duration_ms = product.license_duration_days * 24 * 60 * 60 * 1000;
                now + duration_ms
            };

            let license_id_uid = object::new(ctx);
            let license_id     = object::uid_to_inner(&license_id_uid);

            let license = SoftwareLicense {
                id:                license_id_uid,
                product_id:        object::uid_to_inner(&product.id),
                owner:             buyer,
                license_key,
                license_type:      product.license_type,
                max_activations:   product.license_max_activations,
                activations_used:  0,
                activated_devices: vector::empty(),
                issued_at:         now,
                expires_at,
                is_revoked:        false,
            };

            event::emit(LicenseIssued {
                license_id,
                product_id: object::uid_to_inner(&product.id),
                owner: buyer,
                license_type: product.license_type,
                expires_at,
                timestamp: now,
            });

            transfer::transfer(license, buyer);
        };
    }

    // ======== Resale Functions ========

    /// Seller passes their token — it gets consumed into the listing
    public entry fun list_for_resale(
        token: OwnershipToken,          // ← consumed (not &mut)
        price: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);

        assert!(token.current_owner == sender, ENotTokenOwner);
        assert!(!token.is_listed_for_resale, EAlreadyListedForResale);
        assert!(price > 0, EInvalidPrice);

        let token_id            = object::uid_to_inner(&token.id);
        let original_product_id = token.original_product_id;
        let original_seller     = token.original_seller;

        let listing_uid      = object::new(ctx);
        let listing_id_copy  = object::uid_to_inner(&listing_uid);

        let listing = ResaleListing {
            id: listing_uid,
            token,                  // ← token stored inside listing
            seller: sender,
            price,
            original_product_id,
            original_seller,
            listed_at: clock::timestamp_ms(clock),
        };

        transfer::share_object(listing);

        event::emit(ResaleListed {
            listing_id: listing_id_copy,
            token_id,
            seller: sender,
            price,
            original_product_id,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    /// Cancel listing — token returned to seller
    public entry fun delist_resale(
        listing: ResaleListing,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(listing.seller == sender, EUnauthorized);

        let ResaleListing {
            id,
            token,
            seller: _,
            price: _,
            original_product_id: _,
            original_seller: _,
            listed_at: _,
        } = listing;

        let token_id   = object::uid_to_inner(&token.id);
        let listing_id = object::uid_to_inner(&id);

        // Return token to seller
        transfer::transfer(token, sender);
        object::delete(id);

        event::emit(ResaleDelisted {
            listing_id,
            token_id,
            seller: sender,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    /// Buy a resale — only needs listing, no separate token arg
    public entry fun purchase_resale(
        platform: &mut Platform,
        listing: ResaleListing,
        payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let buyer = tx_context::sender(ctx);
        assert!(buyer != listing.seller, EUnauthorized);

        let price = listing.price;
        assert!(coin::value(&payment) == price, EInsufficientPayment);

        let platform_fee = calculate_fee(price, platform.platform_fee_bps);
        let royalty_fee  = calculate_fee(price, ROYALTY_FEE_BPS);
        assert!(platform_fee + royalty_fee <= price, EPlatformFeeOverflow);

        let mut payment_balance = coin::into_balance(payment);
        let fee_balance         = balance::split(&mut payment_balance, platform_fee);
        let royalty_balance     = balance::split(&mut payment_balance, royalty_fee);

        balance::join(&mut platform.treasury, fee_balance);
        platform.total_sales = platform.total_sales + 1;

        let royalty_coin = coin::from_balance(royalty_balance, ctx);
        transfer::public_transfer(royalty_coin, listing.original_seller);

        let seller_coin = coin::from_balance(payment_balance, ctx);
        transfer::public_transfer(seller_coin, listing.seller);

        // Destructure listing to get token out
        let ResaleListing {
            id,
            mut token,
            seller,
            price: _,
            original_product_id,
            original_seller: _,
            listed_at: _,
        } = listing;

        let token_id   = object::uid_to_inner(&token.id);
        let listing_id = object::uid_to_inner(&id);

        // Transfer ownership
        token.previous_owner       = token.current_owner;
        token.current_owner        = buyer;
        token.is_listed_for_resale = false;
        token.resale_price         = 0;
        token.purchase_price       = price;
        token.purchase_timestamp   = clock::timestamp_ms(clock);

        // Transfer token to new owner
        transfer::transfer(token, buyer);
        object::delete(id);

        // Issue receipt to buyer
        let receipt = PurchaseReceipt {
            id: object::new(ctx),
            product_id: original_product_id,
            buyer,
            seller,
            amount_paid: price,
            platform_fee,
            quantity: 1,
            timestamp: clock::timestamp_ms(clock),
        };
        transfer::transfer(receipt, buyer);

        event::emit(ResalePurchased {
            token_id,
            listing_id,
            buyer,
            seller,
            price,
            original_product_id,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    // ======== Review Functions ========

    public entry fun review_product(
        product: &mut Product,
        receipt: &PurchaseReceipt,
        rating: u8,
        comment: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(rating >= MIN_RATING && rating <= MAX_RATING, EInvalidRating);
        assert!(vector::length(&comment) <= MAX_REVIEW_LENGTH, EInvalidQuantity);

        let reviewer = tx_context::sender(ctx);

        assert!(reviewer != product.seller, ESelfReview);
        assert!(receipt.product_id == object::uid_to_inner(&product.id), EUnauthorized);
        assert!(receipt.buyer == reviewer, EUnauthorized);

        let review_key = reviewer;
        assert!(!df::exists_(&product.id, review_key), EAlreadyReviewed);

        let review = Review {
            reviewer,
            rating,
            comment: string::utf8(comment),
            timestamp: clock::timestamp_ms(clock),
            verified_purchase: true,
        };

        df::add(&mut product.id, review_key, review);

        product.review_count = product.review_count + 1;
        product.total_rating_sum = product.total_rating_sum + (rating as u64);

        event::emit(ProductReviewed {
            product_id: object::uid_to_inner(&product.id),
            reviewer,
            rating,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    public entry fun create_buyer_badge(
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let badge = BuyerBadge {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            total_purchases: 0,
            total_spent: 0,
            member_since: clock::timestamp_ms(clock),
            tier: 0,
        };
        transfer::transfer(badge, tx_context::sender(ctx));
    }

    public fun update_buyer_badge(
        badge: &mut BuyerBadge,
        amount_spent: u64,
    ) {
        badge.total_purchases = badge.total_purchases + 1;
        badge.total_spent = badge.total_spent + amount_spent;

        if (badge.total_spent >= 10000000) {
            badge.tier = 3;
        } else if (badge.total_spent >= 5000000) {
            badge.tier = 2;
        } else if (badge.total_spent >= 1000000) {
            badge.tier = 1;
        };
    }

    // ======== Admin Functions ========

    public entry fun withdraw_fees(
        platform: &mut Platform,
        amount: u64,
        ctx: &mut TxContext
    ) {
        assert!(platform.admin == tx_context::sender(ctx), EUnauthorized);
        let withdrawn = balance::split(&mut platform.treasury, amount);
        let coin = coin::from_balance(withdrawn, ctx);
        transfer::public_transfer(coin, platform.admin);
    }

    public entry fun update_platform_fee(
        platform: &mut Platform,
        new_fee_bps: u64,
        ctx: &mut TxContext
    ) {
        assert!(platform.admin == tx_context::sender(ctx), EUnauthorized);
        assert!(new_fee_bps <= MAX_FEE_BPS, EPlatformFeeOverflow);
        platform.platform_fee_bps = new_fee_bps;
    }

    public entry fun verify_seller(
        platform: &Platform,
        profile: &mut SellerProfile,
        ctx: &mut TxContext
    ) {
        assert!(platform.admin == tx_context::sender(ctx), EUnauthorized);
        profile.is_verified = true;
    }

    // ======== Helper Functions ========

    fun calculate_fee(amount: u64, fee_bps: u64): u64 {
        let fee = (amount * fee_bps) / MAX_FEE_BPS;
        assert!(fee <= amount, EPlatformFeeOverflow);
        fee
    }

    // ======== View Functions ========


    // ======== License Functions ========

    /// Activate a license on a device (identified by device_id bytes)
    public entry fun activate_license(
        license: &mut SoftwareLicense,
        device_id: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!license.is_revoked, EProductNotForSale);
        assert!(tx_context::sender(ctx) == license.owner, EUnauthorized);

        // Check not expired
        if (license.expires_at != 0) {
            assert!(clock::timestamp_ms(clock) <= license.expires_at, EProductSoldOut);
        };

        // Check activation limit
        if (license.max_activations != 0) {
            assert!(license.activations_used < license.max_activations, EInsufficientPayment);
        };

        // Check device not already registered
        let mut i = 0;
        let len = vector::length(&license.activated_devices);
        while (i < len) {
            assert!(*vector::borrow(&license.activated_devices, i) != device_id, EInvalidQuantity);
            i = i + 1;
        };

        vector::push_back(&mut license.activated_devices, device_id);
        license.activations_used = license.activations_used + 1;

        event::emit(LicenseActivated {
            license_id: object::uid_to_inner(&license.id),
            device_id,
            activations_used: license.activations_used,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    /// Deactivate a device from a license (frees up an activation slot)
    public entry fun deactivate_device(
        license: &mut SoftwareLicense,
        device_id: vector<u8>,
        ctx: &mut TxContext
    ) {
        assert!(tx_context::sender(ctx) == license.owner, EUnauthorized);
        let mut i = 0;
        let len = vector::length(&license.activated_devices);
        while (i < len) {
            if (*vector::borrow(&license.activated_devices, i) == device_id) {
                vector::remove(&mut license.activated_devices, i);
                license.activations_used = license.activations_used - 1;
                return
            };
            i = i + 1;
        };
    }

    /// Renew a subscription license by paying the renewal price
    public entry fun renew_license(
        platform: &mut Platform,
        license: &mut SoftwareLicense,
        product: &Product,
        payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(license.license_type == 3, EInvalidQuantity); // subscriptions only
        assert!(!license.is_revoked, EProductNotForSale);
        assert!(tx_context::sender(ctx) == license.owner, EUnauthorized);
        assert!(coin::value(&payment) == product.license_renewal_price, EInsufficientPayment);

        let platform_fee = calculate_fee(product.license_renewal_price, platform.platform_fee_bps);
        let mut payment_balance = coin::into_balance(payment);
        let fee_balance = balance::split(&mut payment_balance, platform_fee);
        balance::join(&mut platform.treasury, fee_balance);

        let seller_coin = coin::from_balance(payment_balance, ctx);
        transfer::public_transfer(seller_coin, product.seller);

        // Extend from current expiry or now, whichever is later
        let now = clock::timestamp_ms(clock);
        let base = if (license.expires_at > now) { license.expires_at } else { now };
        let extension_ms = product.license_duration_days * 24 * 60 * 60 * 1000;
        license.expires_at = base + extension_ms;

        event::emit(LicenseRenewed {
            license_id: object::uid_to_inner(&license.id),
            new_expires_at: license.expires_at,
            timestamp: now,
        });
    }

    /// Admin: revoke a license (e.g. fraud, refund)
    public entry fun revoke_license(
        platform: &Platform,
        license: &mut SoftwareLicense,
        ctx: &mut TxContext
    ) {
        assert!(tx_context::sender(ctx) == platform.admin, ENotAdmin);
        license.is_revoked = true;
    }

    /// View license details
    public fun get_license_details(license: &SoftwareLicense): (
        ID, address, u8, u64, u64, u64, u64, bool
    ) {
        (
            license.product_id,
            license.owner,
            license.license_type,
            license.max_activations,
            license.activations_used,
            license.issued_at,
            license.expires_at,
            license.is_revoked
        )
    }

    /// Get the license key (only callable by the owner)
    public fun get_license_key(
        license: &SoftwareLicense,
        ctx: &TxContext
    ): vector<u8> {
        assert!(tx_context::sender(ctx) == license.owner, EUnauthorized);
        license.license_key
    }

    public fun get_product_rating(product: &Product): u64 {
        if (product.review_count == 0) { return 0 };
        product.total_rating_sum / product.review_count
    }

    public fun get_product_details(product: &Product): (address, u64, u64, bool, u64) {
        (product.seller, product.price, product.quantity_available, product.is_active, product.review_count)
    }

    public fun get_seller_stats(profile: &SellerProfile): (u64, u64, bool) {
        (profile.total_sales, profile.average_rating, profile.is_verified)
    }

    public fun get_token_details(token: &OwnershipToken): (ID, address, address, u64, bool, u64) {
        (token.original_product_id, token.current_owner, token.original_seller, token.purchase_price, token.is_listed_for_resale, token.resale_price)
    }

    // ======== Test Functions ========
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(MARKETPLACE {}, ctx);
    }
}