import tensorflow as tf
from tensorflow.keras import layers, models

def build_stacked_bigru(input_shape, num_classes=3, learning_rate=1e-3):
    input_layer = layers.Input(shape=input_shape, name="window_input")
    x = layers.Bidirectional(layers.GRU(64, return_sequences=True), name="bigru_1")(input_layer)
    x = layers.Dropout(0.3, name="dropout_1")(x)
    x = layers.Bidirectional(layers.GRU(32), name="bigru_2")(x)
    x = layers.Dropout(0.3, name="dropout_2")(x)
    x = layers.Dense(32, activation="relu", name="dense_1")(x)
    output_layer = layers.Dense(num_classes, activation="softmax", name="output")(x)
    
    model = models.Model(inputs=input_layer, outputs=output_layer, name="Stacked_BiGRU")
    optimizer = tf.keras.optimizers.Adam(learning_rate=learning_rate)
    model.compile(
        optimizer=optimizer,
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )
    return model
